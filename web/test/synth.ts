/**
 * synth.ts — exact pinhole camera + ballistic bounce + frame renderer.
 * Independent of the engine's math on purpose: this is the ground truth.
 */
import { CALIBRATION_POINTS, COURT } from '../src/core/court';

export type V3 = [number, number, number];

export class SynthCam {
  R: number[][]; C: V3; f: number; cx: number; cy: number; w: number; h: number;
  constructor(C: V3, target: V3, f: number, w: number, h: number) {
    this.C = C; this.f = f; this.w = w; this.h = h; this.cx = w / 2; this.cy = h / 2;
    const norm = (v: V3): V3 => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n]; };
    const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const zc = norm([target[0] - C[0], target[1] - C[1], target[2] - C[2]]);
    const xc = norm(cross(zc, [0, 0, 1]));
    const yc = cross(zc, xc);
    this.R = [xc, yc, zc];
  }
  project(P: V3): [number, number] | null {
    const d: V3 = [P[0] - this.C[0], P[1] - this.C[1], P[2] - this.C[2]];
    const pc = this.R.map((r) => r[0] * d[0] + r[1] * d[1] + r[2] * d[2]);
    if (pc[2] < 0.1) return null;
    return [this.f * pc[0] / pc[2] + this.cx, this.f * pc[1] / pc[2] + this.cy];
  }
  /** Ground homography court(x,y,0) → px, row-major. */
  homography(): number[] {
    const K = [[this.f, 0, this.cx], [0, this.f, this.cy], [0, 0, 1]];
    const t = this.R.map((r) => -(r[0] * this.C[0] + r[1] * this.C[1] + r[2] * this.C[2]));
    const M = [0, 1, 2].map((i) => [this.R[i][0], this.R[i][1], t[i]]);
    const H: number[] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let s = 0; for (let k = 0; k < 3; k++) s += K[i][k] * M[k][j]; H.push(s);
    }
    return H;
  }
  taps(ids: number[], noisePx = 0, rnd: () => number = Math.random) {
    return ids.map((id) => {
      const p = CALIBRATION_POINTS[id];
      const px = this.project([p.x, p.y, 0])!;
      return { pointId: id, u: px[0] + gauss(rnd) * noisePx, v: px[1] + gauss(rnd) * noisePx };
    });
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rnd: () => number): number {
  const u = Math.max(1e-12, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface Bounce {
  xy: [number, number]; tb: number;
  vin: [number, number]; vout: [number, number];
  wIn: number; e: number;
}

export function ballCenter(b: Bounce, t: number): V3 {
  const r = COURT.BALL_RADIUS, g = 9.81;
  if (t <= b.tb) {
    const dt = b.tb - t;
    return [b.xy[0] - b.vin[0] * dt, b.xy[1] - b.vin[1] * dt, r + b.wIn * dt - 0.5 * g * dt * dt];
  }
  const dt = t - b.tb;
  return [b.xy[0] + b.vout[0] * dt, b.xy[1] + b.vout[1] * dt, r + b.e * b.wIn * dt - 0.5 * g * dt * dt];
}

/** Standard rigs (match engine/tests): 2.8 m poles, 2 m outside each sideline at mid-court. */
export const rigA = (w = 3840, h = 2160, f = 2400) => new SynthCam([-5.0, 0.5, 2.8], [-0.2, 4.4, 0], f * w / 3840, w, h);
export const rigB = (w = 3840, h = 2160, f = 2450) => new SynthCam([5.0, 0.5, 2.8], [0.2, 4.4, 0], f * w / 3840, w, h);

// ---------------------------------------------------------------------------
// Frame renderer: court surface + painted lines (via inverse homography per
// pixel), optional static/moving distractors, and the ball as a shaded disk.
// ---------------------------------------------------------------------------
export interface Distractor { u: number; v: number; r: number; rgb: [number, number, number] }

export function makeBackground(cam: SynthCam, lineRgb: [number, number, number] = [235, 235, 225]): Uint8ClampedArray {
  const { w, h } = cam;
  const H = cam.homography();
  const Hi = inv3(H)!;
  const out = new Uint8ClampedArray(w * h * 4);
  const hw = COURT.HALF_WIDTH, hl = COURT.HALF_LENGTH, nv = COURT.NVZ_DEPTH, lw = COURT.LINE_WIDTH;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const W = Hi[6] * (x + 0.5) + Hi[7] * (y + 0.5) + Hi[8];
      let rgb: [number, number, number] = [70, 95, 140]; // sky/backdrop
      if (W > 0) {
        const X = (Hi[0] * (x + 0.5) + Hi[1] * (y + 0.5) + Hi[2]) / W;
        const Y = (Hi[3] * (x + 0.5) + Hi[4] * (y + 0.5) + Hi[5]) / W;
        if (Math.abs(X) < 9 && Math.abs(Y) < 12) {
          rgb = [52, 110, 74]; // green court
          const ax = Math.abs(X), ay = Math.abs(Y);
          const onSide = ax <= hw && ax >= hw - lw && ay <= hl;
          const onBase = ay <= hl && ay >= hl - lw && ax <= hw;
          const onNvz = ay <= nv && ay >= nv - lw && ax <= hw;
          const onCtr = Math.abs(X) <= lw / 2 && ay >= nv && ay <= hl;
          if (onSide || onBase || onNvz || onCtr) rgb = lineRgb;
        }
      }
      out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = 255;
    }
  }
  return out;
}

export function drawDisk(img: Uint8ClampedArray, w: number, h: number, d: Distractor) {
  const x0 = Math.max(0, Math.floor(d.u - d.r - 1)), x1 = Math.min(w - 1, Math.ceil(d.u + d.r + 1));
  const y0 = Math.max(0, Math.floor(d.v - d.r - 1)), y1 = Math.min(h - 1, Math.ceil(d.v + d.r + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    // 4x4 supersampled coverage → anti-aliased edge, like a real lens.
    let cov = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
      if ((px - d.u) ** 2 + (py - d.v) ** 2 <= d.r * d.r) cov++;
    }
    if (!cov) continue;
    const a = cov / 16, i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) img[i + c] = Math.round(img[i + c] * (1 - a) + d.rgb[c] * a);
  }
}

export function addNoise(img: Uint8ClampedArray, sigma: number, rnd: () => number) {
  for (let i = 0; i < img.length; i += 4) {
    const n = gauss(rnd) * sigma;
    img[i] += n; img[i + 1] += n; img[i + 2] += n;
  }
}

export function inv3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k,
    -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}
