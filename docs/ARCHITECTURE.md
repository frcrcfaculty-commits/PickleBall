# PickleJudge Engine v2 — Architecture

## What was wrong and what changed

The legacy pipeline tracked the ball in court coordinates by pushing every frame's pixel through the ground-plane homography. A homography maps points ON its plane; an airborne ball's pixel, intersected with the ground, lands displaced away from the camera by z/tan(elevation). At phone geometries that is 7–30 cm even at the bounce instant (ball centre sits one radius, 36.5 mm, above the ground), and far worse mid-flight. Every downstream quantity — velocities, the "V-shape" bounce test, the interpolated contact point — inherited that bias. Verified in this package's test suite: 135 mm of error at a realistic rig for the legacy mapping versus 6.8 mm for the corrected one.

The v2 engine inverts the data flow. Tracking and bounce fitting happen entirely in image space, where the physics is clean (ballistic flight is locally quadratic in pixels; a bounce is a slope discontinuity). Court coordinates enter exactly once: the fitted contact pixel is mapped through the elevated-plane homography H_r = K[r1 r2 (t + r·r3)], the homography of the plane z = ball radius, which is where the ball's centre actually is at contact. Recovering K, R, t from the calibration homography (focal via the image of the absolute conic, pose via planar decomposition with cheirality and camera-above-ground checks) is what makes H_r constructible from the same six tapped landmarks users already provide.

## Coordinate frame and units

Origin at the net centre on the ground, +Y toward Side B's baseline, +X toward the right sideline as seen from Side A, +Z up, SI metres throughout, exact rulebook conversions (court 6.0960 × 13.4112 m, NVZ line outer edge at 2.1336 m, lines 0.0508 m). The legacy corner-origin inch frame survives only inside old UI components; `courtDimensionsSI.ts` is the boundary.

## Pipeline per device

VisionCamera frame → ball detector (existing FrameProcessorPlugin) → `Engine::feedDetection(t, u, v, r, score)` → gated image-space track (with rolling-shutter timestamp correction) → sliding-knot piecewise-parabolic fit: quadratic v(t) and linear u(t) on each side of a candidate knot, capped to the 8 points adjacent to the knot because the quadratic model is only locally valid under perspective. Contact time τ is the closed-form intersection of the two branch parabolas — sub-frame, measured at 0.4–0.7 ms error in tests against 16.7 ms frames. Acceptance is statistical, not magic-threshold: each branch slope must be significant (≥4σ), the slope jump must be ≥6σ and ≥120 px/s, residuals bounded, τ inside the knot bracket with σ_τ ≤ 20 ms. The event carries an image covariance assembled from the fit covariances plus τ-leakage through the local slopes.

The contact pixel maps through H_r⁻¹ to court metres; covariance propagates by numeric Jacobian congruence, folding in calibration error as small-sample-corrected reprojection sigma (raw RMS × √(2n/(2n−8)); at six points that factor is 1.73 and omitting it makes two honest cameras look mutually inconsistent). If pose recovery failed, the engine falls back to the ground homography but adds a worst-case parallax floor to the covariance so confidence stays honest — a flagged weak answer, never a silently wrong one.

## Two devices

Devices exchange only ~100-byte contact estimates, never frames. Clock alignment is NTP-style four-timestamp sampling over the existing TCP link, but the estimator lives in C++: minimum-RTT cluster retention (Cristian) discards exchanges that ate a JS scheduling stall, and Theil–Sen regression estimates crystal drift (1–20 ppm matters: 60 s of play is ~1 ms). Test result: 0.055 ms offset error under asymmetric 30 ms jitter spikes. Remote contacts are converted to the local timeline on ingest, with the sync uncertainty folded into their timing sigma.

Association pairs local and remote contacts by |Δt| against pooled timing sigma (this is what stops camera A's bounce pairing with camera B's next bounce). Fusion is inverse-covariance weighting, guarded by a χ²(2) consistency test on the disagreement: if one camera is lying (occlusion, wrong ball, stale calibration), the engine keeps the tighter estimate with inflated covariance and flags the call rather than averaging a right answer with a wrong one.

## Verdicts

The rulebook is encoded per context. Rally: any line touch of the correct half is IN. Serve: baseline/sideline/centerline touches are IN, NVZ-line touch is a FAULT — the serve-legal region begins exclusively at the outer edge of the NVZ line. Touching means the ground contact patch (~12 mm radius, configurable) overlaps the line — not the ball's 36.5 mm silhouette; the legacy `IN_TOLERANCE = half line + ball radius` overcalled IN by ~25 mm and has been removed. The verdict is probabilistic: project the contact covariance onto the binding line's normal, P(IN) = Φ(margin/σ). Calls are issued at ≥98 % confidence in either direction; anything between is a NO_CALL with the probability displayed — the honest equivalent of a human judge saying "too close." A measurement with σ > 8 cm abstains unconditionally.

## Placement is part of the error budget

A phone 9.5 m behind the baseline at 2.2 m sees far lines below 8° elevation, where one pixel smears into ~9 cm of depth; no algorithm recovers that. The test rig encodes a placement that works and that the app should recommend: ~2 m outside the sideline near mid-court, 2.5–2.8 m high, 4K capture, main lens. Measured there: single camera 5–8 mm contact error, dual-camera fusion 10 mm with 2.4 mm sigma on a ball clipping the line by 8 mm.

## Test evidence (engine/tests/test_all.cpp, 54 assertions, all passing)

Ground-truth simulation with an exact projective camera and exact ballistic bounce physics, independent of the engine's own math. Parallax A/B: 135.3 mm legacy vs 6.8 mm corrected. Single-camera end-to-end: 8.1 mm contact, 0.66 ms timing, correct IN. Negative control: a smooth flight apex produces no call (this test caught and fixed a real edge-extrapolation failure mode during development). Clock sync: 0.055 ms under asymmetric jitter, 8 ppm drift recovered. Dual-engine end-to-end across a 12.345 s clock offset and the wire protocol: 10 mm fused error, consistent, correct abstention on a genuinely marginal ball.
