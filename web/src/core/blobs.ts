/**
 * blobs.ts — candidate selection on the small motion∧colour mask.
 * Shared by the WebGL detector and the CPU reference detector, so both paths
 * make byte-identical decisions given the same mask.
 *
 * Why moments instead of contour circularity: at detection scale the ball is
 * 2–6 px across. Perimeter-based circularity is pure quantisation noise at
 * that size, and a fast ball is motion-BLURRED into a streak (15 m/s at a
 * 1/250 s exposure smears 6 cm ≈ one ball diameter). Second moments give the
 * minor semi-axis — which is the ball radius whether or not it is blurred —
 * and the aspect ratio, which we bound loosely instead of demanding roundness.
 */
import type { BallDetection } from './types';

export interface BlobConfig {
  minAreaPx: number;        // on the SMALL mask
  maxAreaPx: number;
  maxAspect: number;        // major/minor; blur streaks are allowed up to this
  minFill: number;          // area / (π a b); ~1 for a filled ellipse
  maxFill: number;
  scaleTolerance: number;   // accept rMinor within [rExp/tol, rExp*tol]
  predictionSigmaPx: number;// FULL-RES px; soft bonus for track continuity
  minIsolation: number;     // own area / (own + moving neighbour area)
  isolationRadiusR: number; // neighbourhood radius in expected ball radii
}

export const DEFAULT_BLOB_CONFIG: BlobConfig = {
  minAreaPx: 2,
  maxAreaPx: 900,
  maxAspect: 3.2,
  minFill: 0.45,
  maxFill: 1.6,
  scaleTolerance: 2.4,
  predictionSigmaPx: 120,
  minIsolation: 0.6,
  isolationRadiusR: 6,
};

export interface Blob {
  area: number;
  cx: number; cy: number;        // small-mask coords (pixel centres at +0.5)
  rMinor: number; rMajor: number;
  aspect: number; fill: number;
}

/**
 * 4-connected components over a 0/1 mask. Iterative flood fill with an
 * explicit stack — no recursion, no per-pixel allocation. ~1 ms for 480×270.
 */
export function findBlobs(mask: Uint8Array, w: number, h: number, maxBlobs = 256): Blob[] {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs: Blob[] = [];
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    label[start] = next;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      const px = x + 0.5, py = y + 0.5;
      n++; sx += px; sy += py; sxx += px * px; syy += py * py; sxy += px * py;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
    }
    next++;
    const cx = sx / n, cy = sy / n;
    // Central second moments + 1/12 per axis for pixel area (a single pixel
    // is a unit square, not a point), which keeps tiny blobs well-conditioned.
    const vxx = sxx / n - cx * cx + 1 / 12;
    const vyy = syy / n - cy * cy + 1 / 12;
    const vxy = sxy / n - cx * cy;
    const tr = vxx + vyy;
    const disc = Math.sqrt(Math.max(0, (vxx - vyy) * (vxx - vyy) / 4 + vxy * vxy));
    const l1 = tr / 2 + disc, l2 = Math.max(tr / 2 - disc, 1e-6);
    // For a filled disk of radius r: λ = r²/4 → r = 2√λ.
    const rMajor = 2 * Math.sqrt(l1), rMinor = 2 * Math.sqrt(l2);
    blobs.push({
      area: n, cx, cy, rMinor, rMajor,
      aspect: rMajor / rMinor,
      fill: n / (Math.PI * rMajor * rMinor),
    });
    if (blobs.length >= maxBlobs) break;
  }
  return blobs;
}

export interface SelectArgs {
  blobs: Blob[];
  scale: number;                           // full-res px per small-mask px
  expectedRadiusFull?: (u: number, v: number) => number; // 0 if unknown
  predicted?: { u: number; v: number } | null;
  cfg?: BlobConfig;
}

/** Pick the most ball-like blob, in FULL-RES coordinates. */
export function selectBall(a: SelectArgs): (BallDetection & { blob: Blob }) | null {
  const cfg = a.cfg ?? DEFAULT_BLOB_CONFIG;
  // ISOLATION. The ball is a small moving thing with nothing else moving
  // right next to it. The edge of a moving ball-coloured shirt or shoe
  // fragments into ball-sized blobs that pass every per-blob test — but each
  // fragment sits among other fragments. Sum the moving area around each
  // candidate; fragments of a larger mover fail, an isolated ball passes.
  const isolationOf = (b: Blob, rSmall: number): number => {
    const R = Math.max(5, cfg.isolationRadiusR * rSmall);
    let other = 0;
    for (const o of a.blobs) {
      if (o === b) continue;
      if (Math.hypot(o.cx - b.cx, o.cy - b.cy) - o.rMajor <= R) other += o.area;
    }
    return b.area / (b.area + other);
  };
  let best: (BallDetection & { blob: Blob }) | null = null;
  let bestScore = 0;
  for (const b of a.blobs) {
    if (b.area < cfg.minAreaPx || b.area > cfg.maxAreaPx) continue;
    if (b.aspect > cfg.maxAspect) continue;
    if (b.fill < cfg.minFill || b.fill > cfg.maxFill) continue;

    const u = b.cx * a.scale, v = b.cy * a.scale;
    const rFull = b.rMinor * a.scale;

    // Scale prior: the single strongest false-positive filter. A shirt is
    // 10× too big for a ball at that range no matter how ball-coloured.
    let scaleScore = 0.6;
    const rExp = a.expectedRadiusFull?.(u, v) ?? 0;
    if (rExp > 0.5) {
      const ratio = rFull / rExp;
      if (ratio > cfg.scaleTolerance || ratio < 1 / cfg.scaleTolerance) continue;
      scaleScore = 1 / (1 + Math.abs(Math.log(ratio)));
    }
    const rSmall = rExp > 0.5 ? rExp / a.scale : b.rMinor;
    const iso = isolationOf(b, rSmall);
    if (iso < cfg.minIsolation) continue;
    const shapeScore = 1 / (1 + 0.5 * (b.aspect - 1)) * Math.min(1, b.fill) * iso;
    let trackScore = 0.5;
    if (a.predicted) {
      const du = u - a.predicted.u, dv = v - a.predicted.v;
      const s = cfg.predictionSigmaPx;
      trackScore = Math.exp(-(du * du + dv * dv) / (2 * s * s));
    }
    const score = 0.45 * scaleScore + 0.30 * shapeScore + 0.25 * trackScore;
    if (score > bestScore) {
      bestScore = score;
      best = { u, v, radiusPx: rFull, score: Math.min(1, score), blob: b };
    }
  }
  return best;
}

/**
 * Expected ball radius (full-res px) at image point (u, v) from the ground
 * homography H (court m → px, row-major). A sphere is not foreshortened the
 * way the ground is, so we step one ball diameter along four ground
 * directions and keep the LONGEST image step ≈ f·D/range.
 */
export function makeRadiusPrior(H: number[], ballDiameterM: number):
    (u: number, v: number) => number {
  const Hi = invert3(H);
  if (!Hi) return () => 0;
  const proj = (M: number[], x: number, y: number): [number, number] | null => {
    const w = M[6] * x + M[7] * y + M[8];
    if (Math.abs(w) < 1e-12) return null;
    return [(M[0] * x + M[1] * y + M[2]) / w, (M[3] * x + M[4] * y + M[5]) / w];
  };
  const dirs: Array<[number, number]> = [[1, 0], [0, 1], [0.7071, 0.7071], [0.7071, -0.7071]];
  return (u, v) => {
    const g = proj(Hi, u, v);
    if (!g) return 0;
    let best = 0;
    for (const [dx, dy] of dirs) {
      const p = proj(H, g[0] + dx * ballDiameterM, g[1] + dy * ballDiameterM);
      if (!p) continue;
      best = Math.max(best, Math.hypot(p[0] - u, p[1] - v));
    }
    return best / 2;
  };
}

export function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}
