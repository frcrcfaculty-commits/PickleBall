# Integrating the v2 engine into PickleBall

## Layout — copy into the repo root

    engine/                     # dependency-free C++17 core + tests (this package)
    cpp/PBJEngineJSI.cpp        # JSI binding (add to existing cpp/)
    src/native/NativeEngine.ts  # typed JS surface
    src/native/SyncBridge.ts    # P2P transport -> engine pipe
    src/hooks/useLineJudge.ts   # the hook LiveGameScreen consumes
    src/utils/courtDimensionsSI.ts

## Verify the engine on your machine first (no phone needed)

    cd engine && mkdir build && cd build && cmake .. && make && ./pbj_tests
    # expect: "54 passed, 0 failed"

## Android

In `android/app/src/main/cpp/CMakeLists.txt` (or the existing native build), add
`add_subdirectory(../../../../../engine engine)` and link `pbj_engine`, then add
`cpp/PBJEngineJSI.cpp` to the sources. In the point where the app already
installs JSI bindings (the FrameProcessorPlugin registration path), call
`pbj::installJSI(runtime)`.

## iOS

Add `engine/src/*.cpp`, `engine/include` (header search path), and
`cpp/PBJEngineJSI.cpp` to the app target or a local podspec; call
`pbj::installJSI(runtime)` from the same JSI install hook. C++17, no
dependencies, compiles as-is.

## Frame processor (the one hot-path change)

Where FrameProcessorPlugin.cpp currently converts the detected ball centre to
court coordinates and runs BounceDetector — delete that. Instead forward the
raw detection:

    // inside the frame processor, after ball detection:
    global.PBJEngine.feedDetection(frame.timestamp / 1e9, u, v, radiusPx, score);

VisionCamera timestamps are monotonic nanoseconds; divide by 1e9. If the
platform exposes sensor readout duration, call
`PBJEngine.setRollingShutter(readoutSeconds, imageHeight)` once.

## Calibration screen

Keep the tap UI; replace the target list with `CALIBRATION_POINTS` from
`courtDimensionsSI.ts` (six Side-B intersections minimum), then:

    const res = engine().calibrate(imageW, imageH, toFlatPairs(taps));

Gate "start game" on `res.ok`; surface `res.poseValid` — when false the app
should ask the user to re-tap or reposition (verdicts will abstain a lot
without pose). If factory intrinsics are available
(AVCameraCalibrationData / LENS_INTRINSIC_CALIBRATION), call
`setKnownIntrinsics(f, cx, cy)` before `calibrate` — it removes the
self-calibration step entirely.

## Game screen

    const { lastCall, status, setContext, resetPlay } = useLineJudge(p2pManager);
    // setContext({type:'serve', targetSide:'B', box:'right'}) at each serve
    // setContext({type:'rally', targetSide: sideBallIsHeadingInto}) in play
    // render lastCall: verdict, pIn, marginM, nearestLine

`SyncBridge` (created inside the hook) replaces the maths of `ClockSync.ts`
and the broadcast half of `DecisionEngine.ts`; `P2PManager` is untouched.
`ThermalMonitor`, pairing, and audio all keep working — feed
`lastCall.verdict` to `audioManager` where the old decision callback was.

## Retired legacy code

`cpp/BounceDetector.*`, `cpp/BallTracker.*` (court-space tracking),
`HomographyCalibrator`'s ground-only mapping for airborne points, the
estimator inside `src/engine/ClockSync.ts`, and the geometry inside
`src/engine/DecisionEngine.ts`. Their UI-facing types can stay as thin
adapters over `LineCall` if you want zero screen changes.

## Placement guidance to ship in the UI

Poles ~2 m outside each sideline near mid-court, 2.5–2.8 m high, main lens,
4K/60 (4K/30 works; 60 halves timing latency). Do not place phones behind the
baselines at head height — below ~10 degrees of ray elevation the physics
caps accuracy near ±5 cm regardless of software.
