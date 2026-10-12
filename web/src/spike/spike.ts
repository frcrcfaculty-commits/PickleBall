/**
 * spike.ts — the browser-feasibility gate (task PJ-CORE-02).
 *
 * The decision to go web-first rests on four facts about each target phone.
 * This page measures them on the real device and prints PASS/FAIL:
 *
 *   G1  frame rate     ≥ 55 fps delivered to JS at ≥ 1080p
 *   G2  timestamps     requestVideoFrameCallback available (captureTime preferred)
 *   G3  GPU detector   WebGL2 detector p95 ≤ 8 ms/frame at 1080p
 *   G4  engine         wasm loads and passes a synthetic self-test
 *
 * If iPhone fails G1 or G3, the fallback is the Capacitor native-camera
 * plugin path (docs/DECISION.md §Fallback), NOT a rewrite.
 */
import { Camera, CAMERA_PRESETS, keepAwake } from '../core/camera';
import { GlDetector } from '../core/detector-gl';
import { Engine } from '../core/engine';
import type { FrameInfo } from '../core/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rows = $('rows'), out = $('out'), go = $<HTMLButtonElement>('go'), copy = $<HTMLButtonElement>('copy');

function row(label: string, value: string, cls: '' | 'ok' | 'bad' | 'warn' = '') {
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = `<span>${label}</span><span class="${cls}">${value}</span>`;
  rows.appendChild(d);
}

const pct = (a: number[], p: number) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

interface PresetResult {
  preset: string;
  width: number; height: number; reportedFps: number | undefined;
  measuredFps: number; dropped: number;
  timeSource: FrameInfo['timeSource'] | 'none';
  intervalJitterMs: number;
  detectP50: number; detectP95: number; readbackP95: number;
}

async function measure(cam: Camera, preset: string, seconds: number): Promise<PresetResult> {
  const info = await cam.start(CAMERA_PRESETS[preset]);
  const det = new GlDetector();
  const ts: number[] = [], detMs: number[] = [], rbMs: number[] = [];
  let src: FrameInfo['timeSource'] | 'none' = 'none';
  cam.droppedFrames = 0;
  await new Promise<void>((done) => {
    const t0 = performance.now();
    cam.onFrames((f) => {
      src = f.timeSource;
      ts.push(f.t);
      det.detect(cam.video, f.width, f.height, null);
      if (det.timing.total > 0) { detMs.push(det.timing.total); rbMs.push(det.timing.readback); }
      if (performance.now() - t0 > seconds * 1000) { cam.stop(); done(); }
    });
  });
  const dts = ts.slice(1).map((t, i) => (t - ts[i]) * 1000);
  const fps = ts.length > 1 ? (ts.length - 1) / (ts[ts.length - 1] - ts[0]) : 0;
  return {
    preset, width: info.width, height: info.height, reportedFps: info.frameRate,
    measuredFps: fps, dropped: cam.droppedFrames, timeSource: src,
    intervalJitterMs: pct(dts, 0.95) - pct(dts, 0.05),
    detectP50: pct(detMs, 0.5), detectP95: pct(detMs, 0.95), readbackP95: pct(rbMs, 0.95),
  };
}

async function engineSelfTest(): Promise<{ ok: boolean; detail: string }> {
  try {
    const e = await Engine.load('/pbj_engine.wasm');
    // Exact projections of the six Side-B landmarks from the reference rig
    // (web/test/synth.ts rigA: 2.8 m pole, 2 m outside the left sideline).
    const taps = [
      { pointId: 0, u: 509.3, v: 1202.8 }, { pointId: 1, u: 1436.4, v: 887.1 },
      { pointId: 2, u: 1979.7, v: 702.1 }, { pointId: 3, u: 1894.5, v: 2117.2 },
      { pointId: 4, u: 2723.8, v: 1304.0 }, { pointId: 5, u: 3093.9, v: 941.2 },
    ];
    const r = e.calibrate(3840, 2160, taps);
    return { ok: r.ok && r.poseValid, detail: `calibrate ok=${r.ok} pose=${r.poseValid} rms=${r.reprojRmsPx.toFixed(2)}px` };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

go.onclick = async () => {
  go.disabled = true;
  rows.innerHTML = '';
  out.textContent = 'Running…';
  const release = await keepAwake();
  const cam = new Camera($<HTMLVideoElement>('v'));
  const report: Record<string, unknown> = {
    ua: navigator.userAgent,
    when: new Date().toISOString(),
    rvfc: Camera.frameCallbackSupported(),
    webgl2: GlDetector.isSupported(),
    wakeLock: 'wakeLock' in navigator,
    crossOriginIsolated: (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false,
  };
  try {
    const eng = await engineSelfTest();
    report.engine = eng;
    const results: PresetResult[] = [];
    for (const p of ['1080p60', '4k60', '720p60']) {
      try { results.push(await measure(cam, p, 7)); }
      catch (err) { report[`error_${p}`] = String(err); }
    }
    report.presets = results;
    const best1080 = results.filter((r) => r.height >= 1080).sort((a, b) => b.measuredFps - a.measuredFps)[0];
    const g1 = !!best1080 && best1080.measuredFps >= 55;
    const g2 = Camera.frameCallbackSupported();
    const g3 = !!best1080 && best1080.detectP95 <= 8;
    const g4 = eng.ok;
    report.gates = { G1_fps: g1, G2_timestamps: g2, G3_gpu_detector: g3, G4_engine: g4 };

    row('Engine (wasm)', eng.detail, g4 ? 'ok' : 'bad');
    for (const r of results) {
      row(`${r.preset} → ${r.width}×${r.height}`,
        `${r.measuredFps.toFixed(1)} fps · det p95 ${r.detectP95.toFixed(1)} ms · ${r.timeSource}`,
        r.measuredFps >= 55 && r.detectP95 <= 8 ? 'ok' : r.measuredFps >= 28 ? 'warn' : 'bad');
    }
    row('G1 ≥55 fps at ≥1080p', g1 ? 'PASS' : 'FAIL', g1 ? 'ok' : 'bad');
    row('G2 frame timestamps', g2 ? `PASS (${best1080?.timeSource ?? '?'})` : 'FAIL', g2 ? 'ok' : 'bad');
    row('G3 detector ≤8 ms p95', g3 ? 'PASS' : 'FAIL', g3 ? 'ok' : 'bad');
    row('G4 engine', g4 ? 'PASS' : 'FAIL', g4 ? 'ok' : 'bad');
    const all = g1 && g2 && g3 && g4;
    row('VERDICT', all ? 'WEB PATH VIABLE ON THIS PHONE' : 'SEE FAILED GATES', all ? 'ok' : 'bad');

    const url = import.meta.env.VITE_REPORT_URL as string | undefined;
    if (url) {
      try {
        await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
        row('Report upload', 'sent', 'ok');
      } catch { row('Report upload', 'failed — use Copy', 'warn'); }
    }
  } finally {
    release();
    out.textContent = JSON.stringify(report, null, 2);
    copy.hidden = false;
    go.disabled = false;
  }
};

copy.onclick = async () => {
  try { await navigator.clipboard.writeText(out.textContent ?? ''); copy.textContent = 'Copied'; }
  catch { /* select manually */ }
};
