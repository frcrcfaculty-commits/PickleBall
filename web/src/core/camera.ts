/**
 * camera.ts — rear camera capture with per-frame timestamps.
 *
 * Timestamp source, best first:
 *   captureTime      — sensor capture instant (performance timebase). Exposed
 *                      by Chromium for camera tracks; absent on some Safari builds.
 *   presentationTime — when the frame was handed to the compositor. Carries a
 *                      roughly constant per-device latency; the engine learns
 *                      and removes the inter-device part (latency learning).
 *   now              — callback time; last resort.
 * The source in use is reported in FrameInfo.timeSource and on the spike page.
 */
import type { FrameInfo } from './types';

export interface CameraRequest {
  width: number;        // ideal
  height: number;
  frameRate: number;    // ideal
}

export const CAMERA_PRESETS: Record<string, CameraRequest> = {
  '4k60': { width: 3840, height: 2160, frameRate: 60 },
  '1080p60': { width: 1920, height: 1080, frameRate: 60 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30 },
  '720p60': { width: 1280, height: 720, frameRate: 60 },
};

export interface CameraInfo {
  width: number;
  height: number;
  frameRate: number | undefined;
  label: string;
  settings: MediaTrackSettings;
  capabilities: MediaTrackCapabilities | null;
}

type VfcMeta = {
  presentationTime: number; expectedDisplayTime: number;
  width: number; height: number; mediaTime: number; presentedFrames: number;
  captureTime?: number; processingDuration?: number;
};

type VideoWithVfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VfcMeta) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

export class Camera {
  readonly video: VideoWithVfc;
  private stream: MediaStream | null = null;
  private handle = 0;
  private running = false;
  private lastPresented = -1;
  /** Frames the browser presented but our callback never saw (we were too slow). */
  droppedFrames = 0;

  constructor(video?: HTMLVideoElement) {
    this.video = (video ?? document.createElement('video')) as VideoWithVfc;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
  }

  static frameCallbackSupported(): boolean {
    return 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  }

  async start(req: CameraRequest = CAMERA_PRESETS['1080p60']): Promise<CameraInfo> {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: req.width },
        height: { ideal: req.height },
        frameRate: { ideal: req.frameRate, min: Math.min(30, req.frameRate) },
      },
    });
    const track = this.stream.getVideoTracks()[0];
    // Lock exposure/focus where the browser allows it: auto-exposure hunting
    // changes luminance globally and floods the motion mask for a few frames.
    try {
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & Record<string, unknown>;
      const adv: Record<string, unknown> = {};
      if (Array.isArray(caps?.focusMode) && (caps.focusMode as string[]).includes('continuous')) adv.focusMode = 'continuous';
      if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv as MediaTrackConstraintSet] });
    } catch { /* optional */ }
    this.video.srcObject = this.stream;
    await this.video.play();
    const s = track.getSettings();
    return {
      width: this.video.videoWidth || s.width || 0,
      height: this.video.videoHeight || s.height || 0,
      frameRate: s.frameRate,
      label: track.label,
      settings: s,
      capabilities: track.getCapabilities ? track.getCapabilities() : null,
    };
  }

  /** Lock auto-exposure at its current value (call once the court is framed). */
  async lockExposure(): Promise<boolean> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return false;
    try {
      const caps = track.getCapabilities?.() as unknown as Record<string, unknown>;
      if (Array.isArray(caps?.exposureMode) && (caps.exposureMode as string[]).includes('manual')) {
        await track.applyConstraints({ advanced: [{ exposureMode: 'manual' } as unknown as MediaTrackConstraintSet] });
        return true;
      }
    } catch { /* unsupported */ }
    return false;
  }

  /** Calls onFrame once per decoded camera frame. */
  onFrames(onFrame: (frame: FrameInfo) => void): void {
    this.running = true;
    if (this.video.requestVideoFrameCallback) {
      const loop = (now: number, meta: VfcMeta) => {
        if (!this.running) return;
        if (this.lastPresented >= 0 && meta.presentedFrames > this.lastPresented + 1) {
          this.droppedFrames += meta.presentedFrames - this.lastPresented - 1;
        }
        this.lastPresented = meta.presentedFrames;
        let t: number, src: FrameInfo['timeSource'];
        if (typeof meta.captureTime === 'number' && meta.captureTime > 0) { t = meta.captureTime; src = 'captureTime'; }
        else if (typeof meta.presentationTime === 'number' && meta.presentationTime > 0) { t = meta.presentationTime; src = 'presentationTime'; }
        else { t = now; src = 'now'; }
        onFrame({ t: t / 1000, timeSource: src, width: meta.width || this.video.videoWidth, height: meta.height || this.video.videoHeight });
        this.handle = this.video.requestVideoFrameCallback!(loop);
      };
      this.handle = this.video.requestVideoFrameCallback(loop);
    } else {
      // Fallback: rAF + currentTime change detection. Timestamps are
      // display-time quality only; the spike page flags this as a FAIL.
      let lastMediaTime = -1;
      const loop = () => {
        if (!this.running) return;
        if (this.video.currentTime !== lastMediaTime) {
          lastMediaTime = this.video.currentTime;
          onFrame({ t: performance.now() / 1000, timeSource: 'now', width: this.video.videoWidth, height: this.video.videoHeight });
        }
        this.handle = requestAnimationFrame(loop);
      };
      this.handle = requestAnimationFrame(loop);
    }
  }

  stop(): void {
    this.running = false;
    if (this.video.cancelVideoFrameCallback && this.handle) this.video.cancelVideoFrameCallback(this.handle);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.lastPresented = -1;
  }
}

/** Keep the screen awake during play (Screen Wake Lock API). */
export async function keepAwake(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    const lock = await nav.wakeLock?.request('screen');
    return () => { void lock?.release(); };
  } catch {
    return () => {};
  }
}
