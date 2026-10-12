/**
 * detector-cpu.ts — reference ball detector on raw RGBA pixels.
 *
 * This is the SPECIFICATION of the detector. detector-gl.ts implements the
 * identical math in shaders for speed; tests run against this file. If you
 * change the math here, change the shaders in the same commit.
 *
 * Pipeline (all on a frame downscaled by `scale`):
 *   gray, colourFrac   = box-filtered luminance and fraction of ball-coloured
 *                        full-res pixels inside each small pixel
 *   motion             = |gray − background| > motionThresh
 *   mask               = motion ∧ colourFrac ≥ colorFracMin
 *   background         ← background + bgAlpha · (gray − background)
 *   blobs → selectBall (scale prior + shape + track continuity)
 *   refine             = colour-mask centroid at FULL resolution in a ROI
 *
 * Colour is never a gate on its own: painted lines, shirts and shoes match
 * the hue but do not move like a ball (or at all).
 */
import { DEFAULT_BLOB_CONFIG, findBlobs, makeRadiusPrior, selectBall, type BlobConfig } from './blobs';
import type { BallDetection } from './types';

export interface ColorRange {
  hueMinDeg: number;   // inclusive; may wrap (min > max) for reds
  hueMaxDeg: number;
  satMin: number;      // 0..1
  valMin: number;      // 0..1
}

/** Outdoor optic-yellow/green ball. Re-sample per session with sampleBallColor(). */
export const DEFAULT_BALL_COLOR: ColorRange = { hueMinDeg: 45, hueMaxDeg: 95, satMin: 0.35, valMin: 0.35 };

export interface DetectorConfig {
  targetSmallWidth: number;   // detection grid width; scale = round(w / this)
  bgAlpha: number;
  motionThresh: number;       // 0..1 luminance units
  colorFracMin: number;       // fraction of a small pixel that must be ball-coloured
  warmupFrames: number;
  refineRoiMinPx: number;
  refineRoiMaxPx: number;
  blob: BlobConfig;
  color: ColorRange;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  targetSmallWidth: 480,
  bgAlpha: 0.03,
  motionThresh: 0.07,
  colorFracMin: 0.25,
  warmupFrames: 8,
  refineRoiMinPx: 16,
  refineRoiMaxPx: 64,
  blob: DEFAULT_BLOB_CONFIG,
  color: DEFAULT_BALL_COLOR,
};

/** HSV test identical to the GLSL `isBall()` in detector-gl.ts. r,g,b in 0..1. */
export function isBallColor(r: number, g: number, b: number, c: ColorRange): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max;
  if (v < c.valMin) return false;
  const d = max - min;
  const s = max > 1e-6 ? d / max : 0;
  if (s < c.satMin) return false;
  let h: number;
  if (d < 1e-6) h = 0;
  else if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return c.hueMinDeg <= c.hueMaxDeg
    ? h >= c.hueMinDeg && h <= c.hueMaxDeg
    : h >= c.hueMinDeg || h <= c.hueMaxDeg;
}

/**
 * Derive a colour range from pixels around a tapped ball (call once per
 * session/lighting). Returns a range centred on the median hue ± 20°.
 */
export function sampleBallColor(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number,
                                u: number, v: number, radius: number): ColorRange {
  const hues: number[] = [], sats: number[] = [], vals: number[] = [];
  const r0 = Math.max(2, Math.floor(radius * 0.7));
  for (let y = Math.round(v) - r0; y <= Math.round(v) + r0; y++) {
    for (let x = Math.round(u) - r0; x <= Math.round(u) + r0; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if ((x - u) ** 2 + (y - v) ** 2 > r0 * r0) continue;
      const i = (y * w + x) * 4;
      const R = rgba[i] / 255, G = rgba[i + 1] / 255, B = rgba[i + 2] / 255;
      const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
      if (max < 1e-6 || d < 1e-6) continue;
      let hh = max === R ? 60 * (((G - B) / d) % 6) : max === G ? 60 * ((B - R) / d + 2) : 60 * ((R - G) / d + 4);
      if (hh < 0) hh += 360;
      hues.push(hh); sats.push(d / max); vals.push(max);
    }
  }
  if (hues.length < 3) return DEFAULT_BALL_COLOR;
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  const hm = med(hues);
  return {
    hueMinDeg: (hm - 20 + 360) % 360,
    hueMaxDeg: (hm + 20) % 360,
    satMin: Math.max(0.15, med(sats) * 0.5),
    valMin: Math.max(0.15, med(vals) * 0.45),
  };
}

export interface RgbaFrame { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

export class CpuDetector {
  cfg: DetectorConfig;
  private bg: Float32Array | null = null;
  private sw = 0; private sh = 0; private scale = 1;
  private frames = 0;
  private prior: ((u: number, v: number) => number) | undefined;
  /** Last mask, exposed for the debug overlay. */
  lastMask: Uint8Array | null = null;

  constructor(cfg: Partial<DetectorConfig> = {}) {
    this.cfg = { ...DEFAULT_DETECTOR_CONFIG, ...cfg };
  }

  setHomography(H: number[] | null, ballDiameterM = 0.073): void {
    this.prior = H ? makeRadiusPrior(H, ballDiameterM) : undefined;
  }

  setColor(c: ColorRange): void { this.cfg = { ...this.cfg, color: c }; }

  reset(): void { this.bg = null; this.frames = 0; }

  detect(f: RgbaFrame, predicted: { u: number; v: number } | null = null): BallDetection | null {
    const S = Math.max(1, Math.round(f.width / this.cfg.targetSmallWidth));
    const sw = Math.floor(f.width / S), sh = Math.floor(f.height / S);
    if (!this.bg || sw !== this.sw || sh !== this.sh || S !== this.scale) {
      this.sw = sw; this.sh = sh; this.scale = S; this.bg = null; this.frames = 0;
    }
    const gray = new Float32Array(sw * sh);
    const cfrac = new Float32Array(sw * sh);
    const inv = 1 / (S * S * 255);
    const c = this.cfg.color;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let lum = 0, cnt = 0;
        for (let yy = 0; yy < S; yy++) {
          let i = ((y * S + yy) * f.width + x * S) * 4;
          for (let xx = 0; xx < S; xx++, i += 4) {
            const R = f.data[i], G = f.data[i + 1], B = f.data[i + 2];
            lum += 0.299 * R + 0.587 * G + 0.114 * B;
            if (isBallColor(R / 255, G / 255, B / 255, c)) cnt++;
          }
        }
        gray[y * sw + x] = lum * inv;
        cfrac[y * sw + x] = cnt / (S * S);
      }
    }
    if (!this.bg) {
      this.bg = gray.slice();
      this.frames = 1;
      return null;
    }
    const mask = new Uint8Array(sw * sh);
    const a = this.cfg.bgAlpha, th = this.cfg.motionThresh, cm = this.cfg.colorFracMin;
    for (let i = 0; i < sw * sh; i++) {
      const moving = Math.abs(gray[i] - this.bg[i]) > th;
      mask[i] = moving && cfrac[i] >= cm ? 1 : 0;
      this.bg[i] += a * (gray[i] - this.bg[i]);
    }
    this.lastMask = mask;
    if (++this.frames < this.cfg.warmupFrames) return null;

    const pick = selectBall({
      blobs: findBlobs(mask, sw, sh), scale: S,
      expectedRadiusFull: this.prior, predicted, cfg: this.cfg.blob,
    });
    if (!pick) return null;
    return this.refine(f, pick);
  }

  /** Full-resolution colour centroid inside a ROI around the coarse pick. */
  private refine(f: RgbaFrame, d: BallDetection): BallDetection {
    const half = Math.min(this.cfg.refineRoiMaxPx, Math.max(this.cfg.refineRoiMinPx,
      Math.ceil(d.radiusPx * 2.5))) / 2;
    const x0 = Math.max(0, Math.floor(d.u - half)), x1 = Math.min(f.width, Math.ceil(d.u + half));
    const y0 = Math.max(0, Math.floor(d.v - half)), y1 = Math.min(f.height, Math.ceil(d.v + half));
    let n = 0, sx = 0, sy = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * f.width + x) * 4;
        if (isBallColor(f.data[i] / 255, f.data[i + 1] / 255, f.data[i + 2] / 255, this.cfg.color)) {
          n++; sx += x + 0.5; sy += y + 0.5;
        }
      }
    }
    if (n < 3) return d;
    // Guard: a ball touching a ball-coloured LINE (yellow-lined courts) puts
    // static line pixels in the ROI. If the colour area is far larger than the
    // ball can be, the centroid is polluted — keep the motion-gated estimate.
    const rCoarse = Math.max(d.radiusPx, 1);
    if (n > 1.6 * Math.PI * rCoarse * rCoarse + 6) return d;
    return { u: sx / n, v: sy / n, radiusPx: Math.max(d.radiusPx, Math.sqrt(n / Math.PI)), score: d.score };
  }
}
