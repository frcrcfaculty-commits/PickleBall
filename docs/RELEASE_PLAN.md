# Release Plan — PickleJudge

Anchored to today, 10 July 2026. Every phase has an exit gate. A gate that
does not pass does not get waived; the schedule moves.

## Hard external constraints (verified July 2026)

| Constraint | Detail |
|---|---|
| Apple SDK floor | Since 28 Apr 2026, App Store Connect uploads must be built with the **iOS 26 SDK / Xcode 26** or later. You need a Mac running the matching macOS. |
| Play target API | From **31 Aug 2026** new apps must target **Android 16 / API 36**. Build for 36 now; there is no reason to target lower. |
| Play closed testing | Personal Play accounts created after 13 Nov 2023 must run a closed test with **≥12 opted-in testers for 14 continuous days** before production access is granted. **Organization accounts registered to a legal entity are exempt.** |
| Apple Developer Program | USD 99/year. D-U-N-S number required if enrolling as an organization. |
| Play Console | USD 25 one-time. |

**Strategic note on the Play testing gate.** You are already evaluating
business registration for other ventures. Registering the entity first and
enrolling Play as an *organization* removes the 12-tester/14-day gate
entirely and removes ~3–4 weeks of calendar plus the recurring problem of
managing twelve strangers' engagement for two weeks. If the entity is coming
anyway, sequence it before the Play account, not after.

---

## Phase 0 — Merge and compile (1–2 weeks)

- Merge `pbj-engine-v2` into the repo per `INTEGRATION.md`.
- Delete the retired modules; keep their UI-facing types as adapters.
- Wire `SyncBridge.handleMessage()` into `P2PConfig.onMessage`.
- Replace `CVPipeline` detection with `BallDetectorV2`; call
  `setHomography()` after calibration succeeds.
- Get `engine/build/pbj_tests` green in CI on every push.

**Gate 0:** app builds and runs on one physical iPhone and one physical
Android; calibration produces `poseValid: true`; a hand-dropped ball produces
a call. Nothing about accuracy yet.

## Phase 1 — Detector reality check (2–4 weeks) ← the real risk

This is where the project lives or dies. Everything upstream of the geometry
is currently unproven.

- Record 30–60 min of real court video on both phones at the recommended rig.
- Build an offline replay harness: feed recorded frames through
  `BallDetectorV2` and hand-label ~500 frames. Measure precision and recall.
- Tune `motionThresh`, `bgAlpha`, HSV bounds per lighting condition. Ship a
  one-tap "sample the ball colour" calibration step — do not hardcode HSV.

**Gate 1:** detector recall ≥ 95% and precision ≥ 99% on labelled frames
across all four lighting conditions, at < 6 ms/frame on the slowest target
device. If precision cannot reach 99% with classical CV, the fallback is a
small trained detector (the repo already carries `react-native-fast-tflite`);
budget 4–6 additional weeks and a labelled dataset of ~5,000 frames.

## Phase 2 — Field validation (2–3 weeks)

Run `docs/FIELD_VALIDATION.md` end to end. Six sessions, ~1,200 bounces total.

**Gate 2:** `score_validation.py` returns SHIP on the pooled data.

## Phase 3 — Product hardening (3–4 weeks)

- Pairing flow that a non-technical player completes in under 90 seconds.
  This is the #1 abandonment point for any two-device app. QR code carrying
  the peer's IP + session key; automatic fallback from mDNS to manual entry.
- Calibration UX: magnifier loupe on tap, per-point reprojection error shown,
  refuse to proceed above 3 px RMS, explicit "pose failed — reposition the
  phone" state.
- Rig guidance screen: the placement recommendation is part of the accuracy
  budget, not a tip. Ship a diagram and a live "elevation angle too low"
  warning computed from `status().cameraHeightM` and the pose.
- Thermal session per `FIELD_VALIDATION.md`.
- Crash reporting, offline-first, no account required for v1.

**Gate 3:** five strangers complete pair → calibrate → first correct call in
under 5 minutes with no help, on a real court.

## Phase 4 — Store preparation (1–2 weeks, parallel to Phase 3)

Everything in this phase is already drafted in this package:

- `docs/PRIVACY_POLICY.md` — host at a stable HTTPS URL. Required by both
  stores before submission.
- `docs/STORE_LISTING.md` — listing copy, review notes, and the exact answers
  for Apple's App Privacy questions and Google's Data Safety form.
- `ios/PickleJudge/PrivacyInfo.xcprivacy` — the privacy manifest. Missing or
  wrong Required-Reason API declarations is the single most common 2026
  rejection cause.
- `android/BUILD_CONFIG.md` — target SDK 36, permissions, AAB signing.
- Screenshots: 6.9" and 6.5" iPhone, 12.9" iPad if you support it; Play needs
  phone + 7" + 10" tablet or you must declare phone-only.

**Gate 4:** TestFlight build passes Apple's `Validate App` with zero warnings;
Play Console internal track accepts the AAB with no policy flags.

## Phase 5 — Beta (3–5 weeks; 5 if the Play tester gate applies)

- TestFlight external: 40–60 real players across ≥6 courts.
- Play closed testing: 12–20 testers, 14 continuous days. Start the clock the
  day you have any working release — the AAB does not need to be final.
- Answer Play's production-access questionnaire with specifics: what testers
  reported, what you changed. Vague answers are the standard rejection reason.

**Gate 5:** zero confident-wrong-call reports from beta; median pairing time
under 90 s; no crash affecting > 0.5% of sessions.

## Phase 6 — Submit (1–2 weeks review, budget 3 for iOS)

Apple review risks specific to this app, and the pre-emptive answers, are in
`docs/STORE_LISTING.md` under "Review Notes".

---

## Realistic total

**Best case 12 weeks. Expected 20–26 weeks.** The variance is almost entirely
in Phase 1. If classical CV fails Gate 1 and you need a trained detector, add
6 weeks and a data-labelling effort.

## Cost floor

| Item | Cost |
|---|---|
| Apple Developer Program | $99/yr |
| Play Console | $25 once |
| Mac capable of Xcode 26 (if you lack one) | $600–1,200 used |
| Two mid-range Android test phones + two iPhones | you likely have some |
| Two 2.8 m tripods/poles + clamps | ~$120 |
| Privacy policy hosting | ~$0 (GitHub Pages) |
| Play testers (if personal account) | $0 with community swaps, ~$15–60 paid |

## What I cannot do and you must

Physically: run the court sessions, hold the tape measure, test on hardware,
sit in front of Xcode. Administratively: enrol in both programs, provide
government ID and (for Apple org) a D-U-N-S number, sign the agreements, upload
builds, respond to reviewers, recruit testers.

Everything else in this document is already written and in this package.
