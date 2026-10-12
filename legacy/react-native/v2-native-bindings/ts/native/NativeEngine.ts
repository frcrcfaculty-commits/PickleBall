/**
 * NativeEngine.ts — typed surface over the global PBJEngine JSI object.
 * All coordinates are METRES in the net-centred court frame (see
 * docs/ARCHITECTURE.md). All times are SECONDS on the local monotonic clock.
 */
export type Verdict = 'IN' | 'OUT' | 'FAULT' | 'NO_CALL';

export interface LineCall {
  verdict: Verdict;
  pIn: number;          // P(legal) — show it on NO_CALL ("71% in")
  marginM: number;
  sigmaM: number;
  nearestLine: string;
  x: number; y: number;
  t: number;
  cameras: number;
  consistent: boolean;
  parallaxCorrected: boolean;
}

export interface WireContact {
  t: number; tSigma: number;
  x: number; y: number;
  covXX: number; covXY: number; covYY: number;
  evidenceZ: number;
  parallaxCorrected: boolean;
}

export interface EngineStatus {
  calibrated: boolean; poseValid: boolean;
  reprojRmsPx: number; cameraHeightM: number; focalPx: number;
  clockLocked: boolean; clockUncertaintyMs: number; clockDriftPpm: number;
  trackLength: number; peerConnected: boolean;
}

interface PBJEngineJSI {
  calibrate(w: number, h: number, flatPairs: number[]):
    { ok: boolean; error: string; poseValid: boolean; reprojRmsPx: number };
  setKnownIntrinsics(f: number, cx: number, cy: number): void;
  feedDetection(t: number, u: number, v: number, r: number, score: number): void;
  feedSyncSample(t1: number, t2: number, t3: number, t4: number): void;
  feedRemoteContact(t: number, tSigma: number, x: number, y: number,
    cxx: number, cxy: number, cyy: number, z: number, pc: boolean): void;
  setContext(type: 0 | 1, targetSide: 0 | 1, boxSignX: number): void;
  setPeerConnected(c: boolean): void;
  setRollingShutter(readoutS: number, imageH: number): void;
  resetPlay(): void;
  poll(now: number): { outbound: WireContact[]; calls: LineCall[] };
  status(): EngineStatus;
}

declare const global: { PBJEngine?: PBJEngineJSI };

export function engine(): PBJEngineJSI {
  if (!global.PBJEngine) {
    throw new Error(
      'PBJEngine JSI object not installed — call pbj::installJSI(runtime) ' +
      'from the native side (see cpp/PBJEngineJSI.cpp).');
  }
  return global.PBJEngine;
}

/** Monotonic seconds matching VisionCamera frame timestamps. */
export const nowSeconds = (): number => performance.now() / 1000.0;
