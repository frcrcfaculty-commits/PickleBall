/**
 * types.ts — THE CONTRACT between core (Claude) and every other agent.
 *
 * Coordinate frame: metres, origin at net centre on the ground, +Y toward
 * Side B's baseline, +X toward the right sideline as seen from Side A.
 * Time: SECONDS on this device's performance.now() timebase
 * (performance.now() / 1000). Every timestamp crossing a module boundary uses
 * this timebase — never Date.now(), never video.currentTime.
 *
 * Changing anything in this file is a core change: open it under a core task.
 */

export type Verdict = 'IN' | 'OUT' | 'FAULT' | 'NO_CALL';

export type LineName =
  | '' | 'sideline_left' | 'sideline_right' | 'baseline'
  | 'net' | 'nvz_line' | 'centerline';

export interface LineCall {
  verdict: Verdict;
  /** P(legal | measurement). Show it on NO_CALL: "TOO CLOSE — 71% in". */
  pIn: number;
  /** Signed distance of the contact patch from the binding line edge, m. >0 legal. */
  marginM: number;
  /** 1-sigma of marginM, m. */
  sigmaM: number;
  nearestLine: LineName;
  x: number;
  y: number;
  /** Contact time, local seconds. */
  t: number;
  cameras: 1 | 2;
  /** false => the two cameras disagreed; single tighter estimate used. */
  consistent: boolean;
  parallaxCorrected: boolean;
}

/** ~100-byte record exchanged between the two devices per bounce. */
export interface WireContact {
  t: number; tSigma: number;
  x: number; y: number;
  covXX: number; covXY: number; covYY: number;
  evidenceZ: number;
  parallaxCorrected: boolean;
}

export interface EngineStatus {
  calibrated: boolean;
  poseValid: boolean;
  reprojRmsPx: number;
  cameraHeightM: number;
  focalPx: number;
  clockLocked: boolean;
  clockUncertaintyMs: number;
  clockDriftPpm: number;
  trackLength: number;
  peerConnected: boolean;
  /** Learned capture-latency offset of the peer relative to this device, ms. */
  latencyOffsetMs: number;
  latencySamples: number;
}

export type CallContext =
  | { type: 'rally'; targetSide: 'A' | 'B' }
  | { type: 'serve'; targetSide: 'A' | 'B'; box: 'left' | 'right' };

/** One tapped calibration landmark. u, v in VIDEO pixels (not CSS pixels). */
export interface CalibrationTap {
  pointId: number;
  u: number;
  v: number;
}

export interface CalibrationResult {
  ok: boolean;
  poseValid: boolean;
  reprojRmsPx: number;
}

/** A frame handed from the camera layer to the detector. */
export interface FrameInfo {
  /** Capture time, local seconds (captureTime if the browser exposes it). */
  t: number;
  /** Which clock produced t — reported to the spike page and the debug log. */
  timeSource: 'captureTime' | 'presentationTime' | 'now';
  width: number;
  height: number;
}

export interface BallDetection {
  u: number;
  v: number;
  radiusPx: number;
  /** (0, 1] */
  score: number;
}

// ---------------------------------------------------------------------------
// Transport contract (implemented by the UI/pairing agent in src/net/).
// Core only ever talks to this interface.
// ---------------------------------------------------------------------------
export type PeerMessage =
  | { type: 'SYNC_REQ'; seq: number }
  | { type: 'SYNC_RESP'; seq: number; t2: number; t3: number }
  | { type: 'CONTACT'; c: WireContact }
  | { type: 'CALIBRATED'; poseValid: boolean; reprojRmsPx: number }
  | { type: 'CONTEXT'; ctx: CallContext }
  | { type: 'RESET_PLAY' };

export interface Transport {
  /** Must not throw when closed; return false instead. */
  send(msg: PeerMessage): boolean;
  /**
   * Register the single inbound handler. Implementations MUST invoke it
   * synchronously from the socket's message event (no awaits, no queues):
   * the sync estimator timestamps on the handler's first line.
   */
  onMessage(handler: (msg: PeerMessage) => void): void;
  isOpen(): boolean;
  /** 'p2p' (WebRTC DataChannel) or 'relay' (server fan-out). Shown in UI. */
  kind(): 'p2p' | 'relay' | 'none';
  close(): void;
}
