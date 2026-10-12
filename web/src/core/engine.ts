/**
 * engine.ts — typed wrapper over engine/ (C++17) compiled to pbj_engine.wasm.
 * Works in browsers and in Node (tests). One Engine instance per page.
 */
import type {
  CalibrationResult, CalibrationTap, CallContext, EngineStatus, LineCall,
  LineName, Verdict, WireContact,
} from './types';
import { calibrationPoint } from './court';

const ABI_VERSION = 1;
const OUT_STRIDE = 9;
const CALL_STRIDE = 11;
const VERDICTS: Verdict[] = ['IN', 'OUT', 'FAULT', 'NO_CALL'];
const LINES: LineName[] = ['', 'sideline_left', 'sideline_right', 'baseline',
  'net', 'nvz_line', 'centerline'];

interface Exports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  pbj_abi_version(): number;
  pbj_out_stride(): number;
  pbj_call_stride(): number;
  pbj_buffer(): number;
  pbj_input(): number;
  pbj_input_len(): number;
  pbj_reset_engine(): void;
  pbj_set_intrinsics(f: number, cx: number, cy: number): void;
  pbj_calibrate(w: number, h: number, n: number): number;
  pbj_set_context(type: number, side: number, box: number): void;
  pbj_set_peer(c: number): void;
  pbj_set_rolling_shutter(ro: number, h: number): void;
  pbj_feed_detection(t: number, u: number, v: number, r: number, s: number): void;
  pbj_feed_sync(t1: number, t2: number, t3: number, t4: number): void;
  pbj_feed_remote(t: number, ts: number, x: number, y: number, cxx: number,
    cxy: number, cyy: number, z: number, pc: number): void;
  pbj_reset_play(): void;
  pbj_poll(now: number): number;
  pbj_status(): void;
  pbj_ground_to_image(x: number, y: number): number;
  pbj_ground_homography(): number;
}

/** Minimal WASI shim: the engine only ever writes to stderr on abort. */
function wasiShim(getMemory: () => WebAssembly.Memory) {
  return {
    fd_write(_fd: number, iovs: number, iovsLen: number, nwritten: number) {
      const mem = new DataView(getMemory().buffer);
      let total = 0;
      for (let i = 0; i < iovsLen; i++) total += mem.getUint32(iovs + 8 * i + 4, true);
      mem.setUint32(nwritten, total, true);
      return 0;
    },
    fd_close: () => 0,
    fd_seek: () => 0,
    proc_exit: (code: number) => { throw new Error(`pbj engine exit ${code}`); },
  };
}

export class Engine {
  private constructor(private e: Exports) {}

  /** Load from a URL (browser) or raw bytes (Node tests). */
  static async load(source: string | ArrayBuffer | Uint8Array = '/pbj_engine.wasm'): Promise<Engine> {
    let bytes: ArrayBuffer | Uint8Array;
    if (typeof source === 'string') {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`failed to fetch ${source}: ${res.status}`);
      bytes = await res.arrayBuffer();
    } else {
      bytes = source;
    }
    let memRef: WebAssembly.Memory | undefined;
    const module = await WebAssembly.compile(bytes as BufferSource);
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasiShim(() => memRef!),
    });
    const e = instance.exports as unknown as Exports;
    memRef = e.memory;
    e._initialize?.();
    if (e.pbj_abi_version() !== ABI_VERSION || e.pbj_out_stride() !== OUT_STRIDE
        || e.pbj_call_stride() !== CALL_STRIDE) {
      throw new Error('pbj_engine.wasm ABI mismatch — rebuild with engine/build_wasm.sh');
    }
    return new Engine(e);
  }

  private f64(ptr: number, len: number): Float64Array {
    return new Float64Array(this.e.memory.buffer, ptr, len);
  }

  reset(): void { this.e.pbj_reset_engine(); }

  setKnownIntrinsics(f: number, cx: number, cy: number): void {
    this.e.pbj_set_intrinsics(f, cx, cy);
  }

  calibrate(imageW: number, imageH: number, taps: CalibrationTap[]): CalibrationResult {
    const cap = this.e.pbj_input_len() / 4;
    const n = Math.min(taps.length, cap);
    const buf = this.f64(this.e.pbj_input(), n * 4);
    for (let i = 0; i < n; i++) {
      const p = calibrationPoint(taps[i].pointId);
      buf.set([p.x, p.y, taps[i].u, taps[i].v], i * 4);
    }
    const r = this.e.pbj_calibrate(imageW, imageH, n);
    const st = this.status();
    return { ok: (r & 1) !== 0, poseValid: (r & 2) !== 0, reprojRmsPx: st.reprojRmsPx };
  }

  setContext(ctx: CallContext): void {
    const side = ctx.targetSide === 'B' ? 1 : 0;
    if (ctx.type === 'rally') this.e.pbj_set_context(0, side, 1);
    else this.e.pbj_set_context(1, side, ctx.box === 'right' ? 1 : -1);
  }

  setPeerConnected(c: boolean): void { this.e.pbj_set_peer(c ? 1 : 0); }
  setRollingShutter(readoutS: number, imageH: number): void {
    this.e.pbj_set_rolling_shutter(readoutS, imageH);
  }

  feedDetection(t: number, u: number, v: number, radiusPx: number, score: number): void {
    this.e.pbj_feed_detection(t, u, v, radiusPx, score);
  }

  feedSyncSample(t1: number, t2: number, t3: number, t4: number): void {
    this.e.pbj_feed_sync(t1, t2, t3, t4);
  }

  feedRemoteContact(c: WireContact): void {
    this.e.pbj_feed_remote(c.t, c.tSigma, c.x, c.y, c.covXX, c.covXY, c.covYY,
      c.evidenceZ, c.parallaxCorrected ? 1 : 0);
  }

  resetPlay(): void { this.e.pbj_reset_play(); }

  poll(nowSeconds: number): { outbound: WireContact[]; calls: LineCall[] } {
    this.e.pbj_poll(nowSeconds);
    const ptr = this.e.pbj_buffer();
    const head = this.f64(ptr, 2);
    const nOut = head[0], nCalls = head[1];
    const data = this.f64(ptr + 16, nOut * OUT_STRIDE + nCalls * CALL_STRIDE);
    const outbound: WireContact[] = [];
    for (let i = 0; i < nOut; i++) {
      const o = i * OUT_STRIDE;
      outbound.push({
        t: data[o], tSigma: data[o + 1], x: data[o + 2], y: data[o + 3],
        covXX: data[o + 4], covXY: data[o + 5], covYY: data[o + 6],
        evidenceZ: data[o + 7], parallaxCorrected: data[o + 8] > 0.5,
      });
    }
    const calls: LineCall[] = [];
    const base = nOut * OUT_STRIDE;
    for (let i = 0; i < nCalls; i++) {
      const o = base + i * CALL_STRIDE;
      calls.push({
        verdict: VERDICTS[data[o]] ?? 'NO_CALL',
        pIn: data[o + 1], marginM: data[o + 2], sigmaM: data[o + 3],
        nearestLine: LINES[data[o + 4]] ?? '',
        x: data[o + 5], y: data[o + 6], t: data[o + 7],
        cameras: data[o + 8] >= 2 ? 2 : 1,
        consistent: data[o + 9] > 0.5, parallaxCorrected: data[o + 10] > 0.5,
      });
    }
    return { outbound, calls };
  }

  status(): EngineStatus {
    this.e.pbj_status();
    const v = this.f64(this.e.pbj_buffer(), 12);
    return {
      calibrated: v[0] > 0.5, poseValid: v[1] > 0.5, reprojRmsPx: v[2],
      cameraHeightM: v[3], focalPx: v[4], clockLocked: v[5] > 0.5,
      clockUncertaintyMs: v[6], clockDriftPpm: v[7], trackLength: v[8],
      peerConnected: v[9] > 0.5, latencyOffsetMs: v[10], latencySamples: v[11],
    };
  }

  /** Court ground point (m) → video pixel, for drawing the court overlay. */
  groundToImage(x: number, y: number): { u: number; v: number } | null {
    if (!this.e.pbj_ground_to_image(x, y)) return null;
    const v = this.f64(this.e.pbj_buffer(), 2);
    return { u: v[0], v: v[1] };
  }

  /** Ground homography (court m → px), row-major 3x3, or null if uncalibrated. */
  groundHomography(): number[] | null {
    if (!this.e.pbj_ground_homography()) return null;
    return Array.from(this.f64(this.e.pbj_buffer(), 9));
  }
}
