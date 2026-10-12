/**
 * detector-gl.ts — WebGL2 implementation of detector-cpu.ts.
 *
 * GPU does the per-pixel work (downscale, HSV test, background model, motion
 * mask, full-res refinement); the CPU only sees a ~480×270 binary mask and a
 * ≤64×64 ROI. Readback per frame: ~520 KB + ≤16 KB.
 *
 * The math MUST match detector-cpu.ts (the specification). Shader `isBall`
 * mirrors `isBallColor`; the background update mirrors the CPU loop exactly.
 *
 * Every frame:
 *   1. upload video frame → texture
 *   2. pass DOWN:  small RGBA8  (r = gray, g = colourFrac)
 *   3. pass MASK:  small RGBA8  (r = motion ∧ colour) using bg[read]
 *   4. pass BG:    bg[write] = bg[read] + α (gray − bg[read]); swap
 *   5. readPixels(MASK) → findBlobs/selectBall (shared CPU code)
 *   6. pass ROI:   ≤64² full-res colour mask around the pick → centroid
 */
import { findBlobs, makeRadiusPrior, selectBall } from './blobs';
import { DEFAULT_DETECTOR_CONFIG, type ColorRange, type DetectorConfig } from './detector-cpu';
import type { BallDetection } from './types';

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

const HSV_FN = `
uniform vec4 uColor; // hueMin, hueMax (deg), satMin, valMin
bool isBall(vec3 c){
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  if (mx < uColor.w) return false;
  float d = mx - mn;
  float s = mx > 1e-6 ? d / mx : 0.0;
  if (s < uColor.z) return false;
  float h;
  if (d < 1e-6) h = 0.0;
  else if (mx == c.r) h = 60.0 * mod((c.g - c.b) / d, 6.0);
  else if (mx == c.g) h = 60.0 * ((c.b - c.r) / d + 2.0);
  else h = 60.0 * ((c.r - c.g) / d + 4.0);
  if (h < 0.0) h += 360.0;
  return uColor.x <= uColor.y ? (h >= uColor.x && h <= uColor.y)
                              : (h >= uColor.x || h <= uColor.y);
}`;

// NOTE: texelFetch addresses the uploaded video texture in its own pixel
// grid, row 0 = TOP of the image (UNPACK_FLIP_Y is false), which matches
// video/ImageData pixel coordinates used everywhere else.
const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uVideo; uniform int uS; ${HSV_FN}
out vec4 o;
void main(){
  ivec2 base = ivec2(gl_FragCoord.xy) * uS;
  float lum = 0.0, cnt = 0.0;
  for (int y = 0; y < 16; y++) { if (y >= uS) break;
    for (int x = 0; x < 16; x++) { if (x >= uS) break;
      vec3 c = texelFetch(uVideo, base + ivec2(x, y), 0).rgb;
      lum += dot(c, vec3(0.299, 0.587, 0.114));
      if (isBall(c)) cnt += 1.0;
  } }
  float n = float(uS * uS);
  o = vec4(lum / n, cnt / n, 0.0, 1.0);
}`;

const FS_MASK = `#version 300 es
precision highp float;
uniform sampler2D uCur; uniform sampler2D uBg;
uniform float uThresh; uniform float uColorMin;
out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 c = texelFetch(uCur, p, 0).rg;
  float bg = texelFetch(uBg, p, 0).r;
  float m = (abs(c.r - bg) > uThresh && c.g >= uColorMin) ? 1.0 : 0.0;
  o = vec4(m, 0.0, 0.0, 1.0);
}`;

const FS_BG = `#version 300 es
precision highp float;
uniform sampler2D uCur; uniform sampler2D uBg; uniform float uAlpha; uniform int uInit;
out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  float g = texelFetch(uCur, p, 0).r;
  float b = texelFetch(uBg, p, 0).r;
  o = vec4(uInit == 1 ? g : b + uAlpha * (g - b), 0.0, 0.0, 1.0);
}`;

const FS_ROI = `#version 300 es
precision highp float;
uniform sampler2D uVideo; uniform ivec2 uOrigin; ${HSV_FN}
out vec4 o;
void main(){
  vec3 c = texelFetch(uVideo, uOrigin + ivec2(gl_FragCoord.xy), 0).rgb;
  o = vec4(isBall(c) ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}`;

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

export class GlDetector {
  cfg: DetectorConfig;
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private video!: WebGLTexture;
  private cur!: { tex: WebGLTexture; fb: WebGLFramebuffer };
  private mask!: { tex: WebGLTexture; fb: WebGLFramebuffer };
  private bg!: Array<{ tex: WebGLTexture; fb: WebGLFramebuffer }>;
  private roi!: { tex: WebGLTexture; fb: WebGLFramebuffer };
  private bgRead = 0;
  private progs: Record<'down' | 'mask' | 'bg' | 'roi', Prog>;
  private sw = 0; private sh = 0; private S = 1; private vw = 0; private vh = 0;
  private frames = 0;
  private maskPixels = new Uint8Array(0);
  private maskBits = new Uint8Array(0);
  private roiPixels = new Uint8Array(64 * 64 * 4);
  private prior: ((u: number, v: number) => number) | undefined;
  private floatBg: boolean;
  /** Milliseconds spent in the last detect() call, split by stage. */
  timing = { gpu: 0, readback: 0, blobs: 0, total: 0 };

  static isSupported(): boolean {
    try {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      return !!(c as HTMLCanvasElement).getContext('webgl2');
    } catch { return false; }
  }

  constructor(cfg: Partial<DetectorConfig> = {}) {
    this.cfg = { ...DEFAULT_DETECTOR_CONFIG, ...cfg };
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const gl = (this.canvas as HTMLCanvasElement).getContext('webgl2', {
      antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    // Half-float render targets keep the slow background average from
    // stalling on 8-bit rounding (α·Δ < 1/255 would never move an RGBA8 bg).
    this.floatBg = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    this.progs = {
      down: this.program(FS_DOWN, ['uVideo', 'uS', 'uColor']),
      mask: this.program(FS_MASK, ['uCur', 'uBg', 'uThresh', 'uColorMin']),
      bg: this.program(FS_BG, ['uCur', 'uBg', 'uAlpha', 'uInit']),
      roi: this.program(FS_ROI, ['uVideo', 'uOrigin', 'uColor']),
    };
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.video = this.texture(1, 1, false);
    this.roi = this.target(64, 64, false);
  }

  setHomography(H: number[] | null, ballDiameterM = 0.073): void {
    this.prior = H ? makeRadiusPrior(H, ballDiameterM) : undefined;
  }
  setColor(c: ColorRange): void { this.cfg = { ...this.cfg, color: c }; }
  reset(): void { this.frames = 0; }
  /** Last mask (small grid, 0/1), for the debug overlay. */
  get lastMask(): { data: Uint8Array; width: number; height: number } {
    return { data: this.maskBits, width: this.sw, height: this.sh };
  }

  detect(source: TexImageSource, width: number, height: number,
         predicted: { u: number; v: number } | null = null): BallDetection | null {
    const t0 = performance.now();
    const gl = this.gl;
    const S = Math.max(1, Math.min(16, Math.round(width / this.cfg.targetSmallWidth)));
    if (S !== this.S || width !== this.vw || height !== this.vh) this.resize(width, height, S);

    gl.bindTexture(gl.TEXTURE_2D, this.video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    const col = this.cfg.color;
    // DOWN
    this.use('down', this.cur.fb, this.sw, this.sh);
    this.bindTex(0, this.video, this.progs.down.u.uVideo);
    gl.uniform1i(this.progs.down.u.uS, S);
    gl.uniform4f(this.progs.down.u.uColor, col.hueMinDeg, col.hueMaxDeg, col.satMin, col.valMin);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const init = this.frames === 0;
    const bgR = this.bg[this.bgRead], bgW = this.bg[1 - this.bgRead];
    if (!init) {
      // MASK (against the PREVIOUS background, as in the CPU spec)
      this.use('mask', this.mask.fb, this.sw, this.sh);
      this.bindTex(0, this.cur.tex, this.progs.mask.u.uCur);
      this.bindTex(1, bgR.tex, this.progs.mask.u.uBg);
      gl.uniform1f(this.progs.mask.u.uThresh, this.cfg.motionThresh);
      gl.uniform1f(this.progs.mask.u.uColorMin, this.cfg.colorFracMin);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // BG update
    this.use('bg', bgW.fb, this.sw, this.sh);
    this.bindTex(0, this.cur.tex, this.progs.bg.u.uCur);
    this.bindTex(1, bgR.tex, this.progs.bg.u.uBg);
    gl.uniform1f(this.progs.bg.u.uAlpha, this.cfg.bgAlpha);
    gl.uniform1i(this.progs.bg.u.uInit, init ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.bgRead = 1 - this.bgRead;
    this.frames++;
    const t1 = performance.now();
    if (init || this.frames < this.cfg.warmupFrames) {
      this.timing = { gpu: t1 - t0, readback: 0, blobs: 0, total: t1 - t0 };
      return null;
    }

    // READBACK mask
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mask.fb);
    gl.readPixels(0, 0, this.sw, this.sh, gl.RGBA, gl.UNSIGNED_BYTE, this.maskPixels);
    // Framebuffer row 0 == texture row 0 == image TOP row (we never flipped),
    // so no vertical flip is needed here.
    for (let i = 0, n = this.sw * this.sh; i < n; i++) this.maskBits[i] = this.maskPixels[i * 4] > 127 ? 1 : 0;
    const t2 = performance.now();

    const pick = selectBall({
      blobs: findBlobs(this.maskBits, this.sw, this.sh), scale: S,
      expectedRadiusFull: this.prior, predicted, cfg: this.cfg.blob,
    });
    const t3 = performance.now();
    const out = pick ? this.refine(pick) : null;
    const t4 = performance.now();
    this.timing = { gpu: t1 - t0, readback: t2 - t1, blobs: t3 - t2, total: t4 - t0 };
    return out;
  }

  private refine(d: BallDetection): BallDetection {
    const gl = this.gl;
    const size = Math.min(this.cfg.refineRoiMaxPx, Math.max(this.cfg.refineRoiMinPx, Math.ceil(d.radiusPx * 2.5)));
    const ox = Math.max(0, Math.min(this.vw - size, Math.round(d.u - size / 2)));
    const oy = Math.max(0, Math.min(this.vh - size, Math.round(d.v - size / 2)));
    this.use('roi', this.roi.fb, size, size);
    this.bindTex(0, this.video, this.progs.roi.u.uVideo);
    gl.uniform2i(this.progs.roi.u.uOrigin, ox, oy);
    const col = this.cfg.color;
    gl.uniform4f(this.progs.roi.u.uColor, col.hueMinDeg, col.hueMaxDeg, col.satMin, col.valMin);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, this.roiPixels);
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (this.roiPixels[(y * size + x) * 4] > 127) { n++; sx += ox + x + 0.5; sy += oy + y + 0.5; }
    }
    if (n < 3) return d;
    const r = Math.max(d.radiusPx, 1);
    if (n > 1.6 * Math.PI * r * r + 6) return d; // static ball-coloured line in ROI
    return { u: sx / n, v: sy / n, radiusPx: Math.max(d.radiusPx, Math.sqrt(n / Math.PI)), score: d.score };
  }

  // ---------------------------------------------------------------- plumbing
  private resize(w: number, h: number, S: number) {
    this.vw = w; this.vh = h; this.S = S;
    this.sw = Math.floor(w / S); this.sh = Math.floor(h / S);
    this.cur = this.target(this.sw, this.sh, false);
    this.mask = this.target(this.sw, this.sh, false);
    this.bg = [this.target(this.sw, this.sh, this.floatBg), this.target(this.sw, this.sh, this.floatBg)];
    this.maskPixels = new Uint8Array(this.sw * this.sh * 4);
    this.maskBits = new Uint8Array(this.sw * this.sh);
    this.frames = 0;
    this.bgRead = 0;
  }

  private use(name: keyof GlDetector['progs'], fb: WebGLFramebuffer, w: number, h: number) {
    const gl = this.gl;
    gl.useProgram(this.progs[name].p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
  }

  private bindTex(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  private texture(w: number, h: number, float: boolean): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  private target(w: number, h: number, float: boolean): { tex: WebGLTexture; fb: WebGLFramebuffer } {
    const gl = this.gl;
    const tex = this.texture(w, h, float);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      if (float) { this.floatBg = false; return this.target(w, h, false); }
      throw new Error('incomplete framebuffer');
    }
    return { tex, fb };
  }

  private program(fs: string, uniforms: string[]): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const u: Prog['u'] = {};
    for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }
}
