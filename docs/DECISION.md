# DECISION — one web codebase, wrapped for the stores

**Decided 2026-10-12.** Build PickleJudge as a single TypeScript web app (PWA) with the C++ engine
compiled to WebAssembly and the ball detector on the GPU (WebGL2). Ship to the App Store and Play
Store by wrapping the same build with Capacitor. Do **not** build separate native iOS and Android apps.

## Why (first principles)

What the product physically needs from a phone, and where each need is met:

| Need | Native | Browser (2026) | Verdict |
|---|---|---|---|
| Camera frames at ≥1080p60 to code | yes | getUserMedia + requestVideoFrameCallback; **must be measured per phone** (spike.html) | gate G1 |
| Per-frame timestamps | sensor time | captureTime (Chromium) or presentationTime + learned per-device latency | solved in engine (latency learning, tested) |
| Per-pixel CV at frame rate | Metal/NEON | WebGL2 shaders, 0.5 MB readback | gate G3 |
| The geometry/fusion engine | C++ | same C++ → 83 KB wasm, identical test suite | solved |
| Phone-to-phone link | sockets | WebRTC DataChannel, relay fallback | solved by design |
| Screen on, no sleep | yes | Screen Wake Lock (iOS 16.4+) | ok |
| Factory lens intrinsics | yes | no — engine self-calibrates focal (tested to <6 %) | acceptable |

Everything the browser cannot do natively is either already compensated in the engine or is
directly measurable in two minutes on the real phones. Meanwhile the costs fall entirely on the
native side:

- The July "complete" React Native repo was 36 files with no Xcode or Gradle project — it had never
  been built. Native means building two toolchains from zero (Xcode 26 on the Mac, NDK + Gradle),
  which is precisely where agent work historically stalls and burns credits.
- **Iteration speed decides Phase 1.** The detector must be tuned against real courts. A web build
  reaches both test phones via a URL in ~60 s after every landing (Vercel). Native: rebuild, sign,
  TestFlight/USB, per platform, per change.
- **Store gates block testing, not just release.** Play's 12-tester/14-day closed test and Apple
  review sit in front of every native tester. A URL has no gate. Validate first, wrap later.
- **Agent fit.** All four agents are strong at web/TS; Chrome's fake-camera flag lets agents run the
  real pipeline end-to-end on synthetic court video with no phone and no human.
- **Two separate native apps** would double every one of the above for zero accuracy gain.

## Kill criteria (spike.html, run on the iPhone Air and the Razr)

| Gate | Pass | If it fails |
|---|---|---|
| G1 frames | ≥55 fps delivered at ≥1080p | try 720p60 (σ ×1.5); if still failing on iOS → native camera plugin inside the Capacitor shell |
| G2 timestamps | rVFC present | same fallback |
| G3 detector | p95 ≤ 8 ms at 1080p | lower `targetSmallWidth`; then fallback |
| G4 engine | wasm self-test passes | bug — fix |

**Fallback is not a rewrite**: a Capacitor plugin that delivers native frames + sensor timestamps
into the same `Judge` via the `Camera` seam. UI, engine, detector math, pairing, and tests stay.

## Store path

PWA for validation and beta (no gates) → Capacitor wrapper (`mobile/`) → TestFlight + Play closed
test → submission. Apple 4.2 risk for "web wrappers" is mitigated because the app uses native
capabilities (camera, local network, wake lock, haptics) and is not a website repackaged.
