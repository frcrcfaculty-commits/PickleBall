/**
 * pipeline.test.ts — PIXELS TO VERDICT. Rendered frames → reference detector
 * → wasm engine → LineCall, with a yellow-lined court and sensor noise.
 * This is the closest thing to a court session that runs in CI.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COURT, SIDE_B_POINT_IDS } from '../src/core/court';
import { CpuDetector } from '../src/core/detector-cpu';
import { Engine } from '../src/core/engine';
import { addNoise, ballCenter, drawDisk, makeBackground, mulberry32, rigA, type Bounce } from './synth';

const WASM = readFileSync(resolve(__dirname, '../public/pbj_engine.wasm'));

describe('pixels → verdict', () => {
  it('detects, fits and calls a bounce from rendered 720p60 frames', async () => {
    const W = 1280, H = 720;
    const cam = rigA(W, H);
    const rnd = mulberry32(5);
    const e = await Engine.load(WASM);
    const cal = e.calibrate(W, H, cam.taps(SIDE_B_POINT_IDS, 0.4, rnd));
    expect(cal.poseValid).toBe(true);
    e.setContext({ type: 'rally', targetSide: 'B' });
    e.setPeerConnected(false);

    const det = new CpuDetector();
    det.setHomography(e.groundHomography(), COURT.BALL_DIAMETER);
    const bg = makeBackground(cam, [215, 225, 60]);

    // 25 cm inside the right sideline: an unambiguous IN.
    const b: Bounce = { xy: [COURT.HALF_WIDTH - 0.25, 4.0], tb: 1.0, vin: [1.4, 3.0], vout: [1.1, 2.4], wIn: 4.8, e: 0.55 };
    let pred: { u: number; v: number } | null = null;
    const last: Array<{ t: number; u: number; v: number }> = [];
    for (let k = 0; k < 70; k++) {
      const t = 0.45 + k / 60;
      const img = bg.slice();
      const P = ballCenter(b, t);
      const px = cam.project(P);
      if (px) {
        const r = cam.f * COURT.BALL_RADIUS / Math.hypot(P[0] - cam.C[0], P[1] - cam.C[1], P[2] - cam.C[2]);
        drawDisk(img, W, H, { u: px[0], v: px[1], r, rgb: [214, 232, 40] });
      }
      addNoise(img, 2.0, rnd);
      const d = det.detect({ data: img, width: W, height: H }, pred);
      if (!d) continue;
      e.feedDetection(t, d.u, d.v, d.radiusPx, d.score);
      last.push({ t, u: d.u, v: d.v });
      if (last.length >= 2) {
        const a = last[last.length - 2], c = last[last.length - 1];
        pred = { u: 2 * c.u - a.u, v: 2 * c.v - a.v };
      }
    }
    const { calls } = e.poll(3.0);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    const err = Math.hypot(c.x - b.xy[0], c.y - b.xy[1]);
    console.log(`  pixels→verdict: err ${(err * 1000).toFixed(1)} mm, sigma ${(c.sigmaM * 1000).toFixed(1)} mm, ${c.verdict}, pIn ${c.pIn.toFixed(3)}`);
    expect(err).toBeLessThan(0.06);
    expect(Math.abs(c.t - b.tb)).toBeLessThan(0.01);
    expect(c.verdict).toBe('IN');
  });
});
