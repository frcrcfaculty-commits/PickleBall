/**
 * detector.test.ts — the reference detector (the spec for the GL shaders)
 * against rendered frames with known ball positions and real adversaries:
 *   * optic-yellow painted lines (same hue as the ball, static)
 *   * a swaying ball-coloured shirt (moving, right hue, wrong size)
 *   * sensor noise
 */
import { describe, expect, it } from 'vitest';
import { COURT } from '../src/core/court';
import { CpuDetector } from '../src/core/detector-cpu';
import { addNoise, ballCenter, drawDisk, makeBackground, mulberry32, rigA, type Bounce } from './synth';

const W = 1280, H = 720;
const BALL_RGB: [number, number, number] = [214, 232, 40];   // optic yellow
const SHIRT_RGB: [number, number, number] = [205, 225, 55];

function ballRadiusPx(cam: ReturnType<typeof rigA>, P: [number, number, number]): number {
  const d = Math.hypot(P[0] - cam.C[0], P[1] - cam.C[1], P[2] - cam.C[2]);
  return cam.f * COURT.BALL_RADIUS / d;
}

describe('CpuDetector (reference)', () => {
  it('tracks a bouncing ball on a yellow-lined court and ignores a swaying yellow shirt', () => {
    const cam = rigA(W, H);
    const rnd = mulberry32(11);
    const bg = makeBackground(cam, [215, 225, 60]); // YELLOW lines: worst case
    const det = new CpuDetector();
    det.setHomography(cam.homography(), COURT.BALL_DIAMETER);

    const b: Bounce = { xy: [2.2, 4.2], tb: 1.0, vin: [1.5, 2.5], vout: [1.2, 2.0], wIn: 4.8, e: 0.55 };
    let hits = 0, frames = 0, falseHits = 0, maxErr = 0, sse = 0;
    for (let k = 0; k < 60; k++) {
      const t = 0.5 + k / 60;
      const img = bg.slice();
      // A torso-sized ball-coloured shirt near the far baseline, swaying.
      const shirtCtr = cam.project([-2.0 + 0.15 * Math.sin(k / 4), 7.2, 1.2])!;
      const shirtR = 0.25 * cam.f / Math.hypot(-2 - cam.C[0], 7.2 - cam.C[1], 1.2 - cam.C[2]);
      drawDisk(img, W, H, { u: shirtCtr[0], v: shirtCtr[1], r: shirtR, rgb: SHIRT_RGB });
      const P = ballCenter(b, t);
      const px = cam.project(P)!;
      drawDisk(img, W, H, { u: px[0], v: px[1], r: ballRadiusPx(cam, P), rgb: BALL_RGB });
      addNoise(img, 2.0, rnd);

      const d = det.detect({ data: img, width: W, height: H });
      if (k < 10) continue; // warmup
      frames++;
      if (!d) continue;
      const err = Math.hypot(d.u - px[0], d.v - px[1]);
      const shirtDist = Math.hypot(d.u - shirtCtr[0], d.v - shirtCtr[1]);
      if (shirtDist < shirtR * 1.5) falseHits++;
      else if (err < 4) { hits++; sse += err * err; maxErr = Math.max(maxErr, err); }
    }
    expect(falseHits).toBe(0);
    expect(hits / frames).toBeGreaterThan(0.9);
    // Where the ball's image crosses a SAME-COLOURED line, the motion mask
    // has a hole (ball and line are equally bright) and the centroid biases
    // by ~2 px at 720p. That is physics, not a bug: RMS is the honest metric,
    // and the engine's fit covariance absorbs it.
    expect(Math.sqrt(sse / hits)).toBeLessThan(1.0);
    expect(maxErr).toBeLessThan(3.0);
  });

  it('never fires on a static scene', () => {
    const cam = rigA(W, H);
    const rnd = mulberry32(3);
    const bg = makeBackground(cam, [215, 225, 60]);
    const det = new CpuDetector();
    det.setHomography(cam.homography(), COURT.BALL_DIAMETER);
    let fires = 0;
    for (let k = 0; k < 30; k++) {
      const img = bg.slice();
      addNoise(img, 2.0, rnd);
      if (det.detect({ data: img, width: W, height: H })) fires++;
    }
    expect(fires).toBe(0);
  });
});
