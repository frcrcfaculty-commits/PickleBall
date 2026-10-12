/**
 * judge.ts — the one object the UI talks to.
 *
 *   camera frames → detector → engine.feedDetection
 *   engine.poll   → outbound contacts → transport
 *   transport     → clock sync samples / remote contacts → engine
 *   engine.poll   → LineCall events → UI listeners (+ forwarded to peer)
 *
 * The UI owns screens and pairing; it hands the Judge a Camera, a Transport
 * (or none for single-camera mode) and listens for calls/status.
 */
import { Camera } from './camera';
import { COURT } from './court';
import { CpuDetector } from './detector-cpu';
import { GlDetector } from './detector-gl';
import type { Engine } from './engine';
import type {
  BallDetection, CalibrationResult, CalibrationTap, CallContext, EngineStatus,
  FrameInfo, LineCall, PeerMessage, Transport,
} from './types';

const SYNC_INTERVAL_MS = 1000;

export interface JudgeEvents {
  onCall?: (c: LineCall) => void;
  onStatus?: (s: EngineStatus & { fps: number; detectMs: number; timeSource: FrameInfo['timeSource'] | '' }) => void;
  /** Every detection, for overlays and the validation logger. */
  onDetection?: (d: BallDetection | null, f: FrameInfo) => void;
  onPeerMessage?: (m: PeerMessage) => void;
}

export class Judge {
  readonly detector: GlDetector | CpuDetector;
  private transport: Transport | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private pollRaf = 0;
  private pending = new Map<number, number>();
  private seq = 0;
  private lastDet: Array<{ t: number; u: number; v: number }> = [];
  private frameTimes: number[] = [];
  private lastTimeSource: FrameInfo['timeSource'] | '' = '';
  private scratch: HTMLCanvasElement | null = null;
  private running = false;

  constructor(readonly engine: Engine, readonly camera: Camera, private ev: JudgeEvents = {}) {
    this.detector = GlDetector.isSupported() ? new GlDetector() : new CpuDetector();
  }

  setEvents(ev: JudgeEvents): void { this.ev = ev; }

  // ----------------------------------------------------------- calibration
  calibrate(taps: CalibrationTap[]): CalibrationResult {
    const r = this.engine.calibrate(this.camera.video.videoWidth, this.camera.video.videoHeight, taps);
    this.detector.setHomography(r.ok ? this.engine.groundHomography() : null, COURT.BALL_DIAMETER);
    this.detector.reset();
    this.transport?.send({ type: 'CALIBRATED', poseValid: r.poseValid, reprojRmsPx: r.reprojRmsPx });
    return r;
  }

  setContext(ctx: CallContext, broadcast = true): void {
    this.engine.setContext(ctx);
    if (broadcast) this.transport?.send({ type: 'CONTEXT', ctx });
  }

  resetPlay(broadcast = true): void {
    this.engine.resetPlay();
    this.lastDet = [];
    if (broadcast) this.transport?.send({ type: 'RESET_PLAY' });
  }

  // ------------------------------------------------------------- transport
  attachTransport(t: Transport | null): void {
    this.transport = t;
    this.engine.setPeerConnected(!!t && t.isOpen());
    if (!t) return;
    t.onMessage((m) => this.handlePeer(m));
  }

  private handlePeer(m: PeerMessage): void {
    switch (m.type) {
      case 'SYNC_REQ': {
        const t2 = performance.now() / 1000;          // FIRST line: tightest t2
        this.transport?.send({ type: 'SYNC_RESP', seq: m.seq, t2, t3: performance.now() / 1000 });
        return;
      }
      case 'SYNC_RESP': {
        const t4 = performance.now() / 1000;          // FIRST line: tightest t4
        const t1 = this.pending.get(m.seq);
        this.pending.delete(m.seq);
        if (t1 !== undefined) this.engine.feedSyncSample(t1, m.t2, m.t3, t4);
        return;
      }
      case 'CONTACT':
        this.engine.feedRemoteContact(m.c);
        return;
      case 'CONTEXT':
        this.engine.setContext(m.ctx);
        break;
      case 'RESET_PLAY':
        this.engine.resetPlay();
        this.lastDet = [];
        break;
    }
    this.ev.onPeerMessage?.(m);
  }

  // ------------------------------------------------------------------ run
  start(): void {
    if (this.running) return;
    this.running = true;
    this.camera.onFrames((f) => this.onFrame(f));
    this.syncTimer = setInterval(() => {
      const t = this.transport;
      this.engine.setPeerConnected(!!t && t.isOpen());
      if (!t || !t.isOpen()) return;
      const seq = this.seq++;
      if (this.pending.size > 32) this.pending.delete(this.pending.keys().next().value!);
      const t1 = performance.now() / 1000;          // IMMEDIATELY before send
      this.pending.set(seq, t1);
      t.send({ type: 'SYNC_REQ', seq });
    }, SYNC_INTERVAL_MS);
    const pollLoop = () => {
      if (!this.running) return;
      const { outbound, calls } = this.engine.poll(performance.now() / 1000);
      for (const c of outbound) this.transport?.send({ type: 'CONTACT', c });
      // Both devices fuse symmetrically and reach the same call independently,
      // so calls are NOT forwarded (that would double every announcement).
      for (const c of calls) this.ev.onCall?.(c);
      this.pollRaf = requestAnimationFrame(pollLoop);
    };
    this.pollRaf = requestAnimationFrame(pollLoop);
    this.statusTimer = setInterval(() => {
      const ft = this.frameTimes;
      const fps = ft.length > 1 ? (ft.length - 1) / (ft[ft.length - 1] - ft[0]) : 0;
      const detectMs = this.detector instanceof GlDetector ? this.detector.timing.total : 0;
      this.ev.onStatus?.({ ...this.engine.status(), fps, detectMs, timeSource: this.lastTimeSource });
    }, 500);
  }

  stop(): void {
    this.running = false;
    this.camera.stop();
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    cancelAnimationFrame(this.pollRaf);
  }

  private predict(t: number): { u: number; v: number } | null {
    const d = this.lastDet;
    if (d.length < 2) return null;
    const a = d[d.length - 2], b = d[d.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0 || t - b.t > 0.2) return null;
    const k = (t - b.t) / dt;
    return { u: b.u + (b.u - a.u) * k, v: b.v + (b.v - a.v) * k };
  }

  private onFrame(f: FrameInfo): void {
    this.lastTimeSource = f.timeSource;
    this.frameTimes.push(f.t);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    if (!this.engine.status().calibrated) return;

    let det: BallDetection | null;
    const pred = this.predict(f.t);
    if (this.detector instanceof GlDetector) {
      det = this.detector.detect(this.camera.video, f.width, f.height, pred);
    } else {
      // CPU fallback (no WebGL2): draw the frame to a canvas and read it.
      if (!this.scratch) this.scratch = document.createElement('canvas');
      this.scratch.width = f.width; this.scratch.height = f.height;
      const ctx = this.scratch.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(this.camera.video, 0, 0);
      const img = ctx.getImageData(0, 0, f.width, f.height);
      det = this.detector.detect({ data: img.data, width: f.width, height: f.height }, pred);
    }
    this.ev.onDetection?.(det, f);
    if (!det) return;
    this.lastDet.push({ t: f.t, u: det.u, v: det.v });
    if (this.lastDet.length > 4) this.lastDet.shift();
    this.engine.feedDetection(f.t, det.u, det.v, det.radiusPx, det.score);
  }
}
