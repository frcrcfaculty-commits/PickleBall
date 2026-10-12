/**
 * engine.test.ts — the WASM build of engine/ driven through the TypeScript
 * wrapper, against exact synthetic ground truth. Proves the C ABI, buffer
 * strides, and timebase conventions end to end.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COURT, SIDE_B_POINT_IDS } from '../src/core/court';
import { Engine } from '../src/core/engine';
import { ballCenter, gauss, mulberry32, rigA, rigB, type Bounce } from './synth';

const WASM = readFileSync(resolve(__dirname, '../public/pbj_engine.wasm'));

describe('engine (wasm)', () => {
  it('calibrates with pose and calls a single-camera bounce correctly', async () => {
    const e = await Engine.load(WASM);
    const cam = rigA();
    const rnd = mulberry32(1);
    const cal = e.calibrate(cam.w, cam.h, cam.taps(SIDE_B_POINT_IDS, 0.5, rnd));
    expect(cal.ok).toBe(true);
    expect(cal.poseValid).toBe(true);
    expect(cal.reprojRmsPx).toBeLessThan(1.5);
    e.setContext({ type: 'rally', targetSide: 'B' });
    e.setPeerConnected(false);

    const b: Bounce = { xy: [COURT.HALF_WIDTH - 0.03, 4.6], tb: 10.317, vin: [2.6, 3.4], vout: [2.1, 2.7], wIn: 5.2, e: 0.55 };
    for (let k = 0; k < 40; k++) {
      const t = b.tb - 0.33 + k / 60;
      const px = cam.project(ballCenter(b, t));
      if (px) e.feedDetection(t, px[0] + gauss(rnd) * 0.7, px[1] + gauss(rnd) * 0.7, 14, 0.9);
    }
    const { outbound, calls } = e.poll(b.tb + 1);
    expect(outbound).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    const err = Math.hypot(c.x - b.xy[0], c.y - b.xy[1]);
    expect(err).toBeLessThan(0.03);
    expect(Math.abs(c.t - b.tb)).toBeLessThan(0.006);
    expect(c.verdict).toBe('IN');
    expect(c.nearestLine).toBe('sideline_right');
    expect(c.parallaxCorrected).toBe(true);

    // overlay helpers round-trip
    const H = e.groundHomography();
    expect(H).not.toBeNull();
    const p = e.groundToImage(1.0, 4.0)!;
    const truth = cam.project([1.0, 4.0, 0])!;
    expect(Math.hypot(p.u - truth[0], p.v - truth[1])).toBeLessThan(3);
  });

  it('fuses two devices across clock offset AND unknown capture latency', async () => {
    const A = await Engine.load(WASM), B = await Engine.load(WASM);
    const camA = rigA(), camB = rigB();
    const rnd = mulberry32(7);
    expect(A.calibrate(camA.w, camA.h, camA.taps(SIDE_B_POINT_IDS, 0.5, rnd)).poseValid).toBe(true);
    expect(B.calibrate(camB.w, camB.h, camB.taps(SIDE_B_POINT_IDS, 0.5, rnd)).poseValid).toBe(true);
    for (const x of [A, B]) { x.setPeerConnected(true); x.setContext({ type: 'rally', targetSide: 'B' }); }

    const theta = 4.2;       // B clock = A clock + theta
    const latencyB = 0.038;  // B's frames stamped 38 ms late (presentationTime)
    for (let i = 0; i < 30; i++) {
      const t1 = 1 + i * 0.2;
      const t2 = t1 + 0.002 + Math.abs(gauss(rnd)) * 0.001 + theta;
      const t3 = t2 + 0.0003;
      const t4 = t3 - theta + 0.002 + Math.abs(gauss(rnd)) * 0.001;
      A.feedSyncSample(t1, t2, t3, t4);
    }
    expect(A.status().clockLocked).toBe(true);

    const spots: Array<[number, number]> = [[1.2, 4.0], [-1.8, 5.5], [2.5, 3.1], [-0.6, 6.0], [0.9, 2.8]];
    let fused = 0;
    spots.forEach((xy, i) => {
      const b: Bounce = { xy, tb: 40 + 2 * i, vin: [0.8, 3.2], vout: [0.6, 2.6], wIn: 4.6, e: 0.55 };
      for (let k = 0; k < 40; k++) {
        const tA = b.tb - 0.33 + k / 60;
        const P = ballCenter(b, tA);
        const pa = camA.project(P), pb = camB.project(P);
        if (pa) A.feedDetection(tA, pa[0] + gauss(rnd) * 0.7, pa[1] + gauss(rnd) * 0.7, 14, 0.9);
        if (pb) B.feedDetection(tA + theta + latencyB, pb[0] + gauss(rnd) * 0.7, pb[1] + gauss(rnd) * 0.7, 14, 0.9);
      }
      const ob = B.poll(b.tb + theta + 1).outbound;
      ob.forEach((c) => A.feedRemoteContact(c));
      const calls = A.poll(b.tb + 1).calls;
      expect(calls).toHaveLength(1);
      if (calls[0].cameras === 2) fused++;
      expect(Math.hypot(calls[0].x - xy[0], calls[0].y - xy[1])).toBeLessThan(0.02);
    });
    expect(fused).toBe(spots.length);
    const st = A.status();
    expect(Math.abs(st.latencyOffsetMs - latencyB * 1000)).toBeLessThan(6);
  });
});
