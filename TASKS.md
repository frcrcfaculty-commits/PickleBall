# TASKS.md — the ledger

Rules: edit only your own rows. Status values: `todo` · `doing` · `LANDED <sha>` · `blocked: <why>`.
A row may only say LANDED after `tools/agent/land.sh` printed LANDED for that task.
Branch name for every task = `agent/<owner>/<ID>-<slug>` exactly as listed.

| ID | Owner | Branch | Depends on | Status |
|---|---|---|---|---|
| PJ-CORE-01 | claude | agent/claude/PJ-CORE-01-bootstrap | — | LANDED bdca051 |
| PJ-OPS-01 | hermes | agent/hermes/PJ-OPS-01-deploy | CORE-01 | LANDED 1b42f72 |
| PJ-UI-01 | antigravity | agent/antigravity/PJ-UI-01-app-shell | CORE-01 | todo |
| PJ-VAL-01 | gemini | agent/gemini/PJ-VAL-01-synth-video | CORE-01 | todo |
| PJ-NET-01 | antigravity | agent/antigravity/PJ-NET-01-pairing | UI-01, OPS-01 | todo |
| PJ-VAL-02 | gemini | agent/gemini/PJ-VAL-02-e2e-harness | VAL-01 | todo |
| PJ-VAL-03 | gemini | agent/gemini/PJ-VAL-03-field-logger | UI-01 | todo |
| PJ-OPS-02 | hermes | agent/hermes/PJ-OPS-02-watchdog | OPS-01 | todo |
| PJ-UI-02 | antigravity | agent/antigravity/PJ-UI-02-pwa | UI-01 | todo |
| PJ-OPS-03 | hermes | agent/hermes/PJ-OPS-03-store-pages | OPS-01 | todo |
| PJ-CORE-02 | claude | agent/claude/PJ-CORE-02-device-gate | OPS-01 + human H-01 | todo |
| PJ-CORE-03 | claude | agent/claude/PJ-CORE-03-detector-tuning | VAL-02 | todo |
| PJ-MOB-01 | antigravity | agent/antigravity/PJ-MOB-01-capacitor | CORE-02, UI-02, human H-03 | todo |

## Human-only items (cannot be delegated — law, payment, or physics)

| ID | What | Time | When |
|---|---|---|---|
| H-00 | One-time logins on the machines agents run on: `gh auth login`, `vercel login`, `supabase login` (agents must never type your passwords) | 10 min | before wave 1 |
| H-01 | Open `<prod-url>/spike.html` on the iPhone Air and the Razr, tap **Run check**, wait 25 s | 2 min | after OPS-01 |
| H-02 | Reply to the watchdog digest when it asks a yes/no question | — | ongoing |
| H-03 | Enrol Apple Developer (₹/$99) + Play Console ($25) — ID + payment | 1 h | before MOB-01 |
| H-04 | Court session: 2 tripods, 2 phones, talc on ball, tape measure (docs/FIELD_VALIDATION.md) | half day | after CORE-03 |

## Specs

### PJ-CORE-01 — bootstrap (claude)
Engine → WASM (zig), TS core (engine wrapper, camera, GPU + CPU detector, Judge), device-check page,
tests (engine via wasm, detector on rendered frames, pixels→verdict), landing machine
(integrate.yml, start.sh, land.sh, status.sh), AGENTS.md, this ledger, DECISION.md.

### PJ-OPS-01 — deploy + backend glue (hermes)
1. GitHub repo settings → Actions → General → Workflow permissions = **Read and write**. Issues enabled.
2. Vercel project from this repo: Root Directory `web`, Framework Vite, Build `npm run build`,
   Output `dist`, Node 22. Production branch `main`; previews for every `agent/**` push.
3. Supabase project `picklejudge` (free tier, region closest to India = ap-south-1). Table
   `device_reports (id uuid pk default gen_random_uuid(), created_at timestamptz default now(),
   ua text, report jsonb)`. RLS on, NO anon policies (server writes with service key).
4. `web/api/report.ts` — Vercel Node function: POST JSON → insert into device_reports using
   `SUPABASE_SERVICE_ROLE_KEY` (server env only). 64 KB body cap. Returns 201.
5. Vercel env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server), `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `VITE_REPORT_URL=/api/report` (client).
6. Write the production URL and preview URL pattern into this file under §Environments.
Acceptance: `<prod>/spike.html` loads over HTTPS on a phone; `curl -X POST <prod>/api/report -d '{"ua":"test","report":{}}'` → 201 and the row is visible in Supabase.

### PJ-UI-01 — app shell, single-camera flow (antigravity · Opus 5 for logic, 3.8 Flash for styling)
Screens (vanilla TS + DOM, no framework; mobile-first, portrait and landscape):
1. **Home**: "One phone" / "Two phones" (two-phone disabled until NET-01), side selector (judging far half = Side B default).
2. **Frame**: live camera, rig guidance (pole ~2 m outside the sideline near mid-court, 2.5–2.8 m high), Start.
3. **Calibrate**: show the 6 Side-B landmarks one at a time (`SIDE_B_POINT_IDS`, names from `CALIBRATION_POINTS`);
   tap → magnifier loupe (3×) → drag to refine → confirm. Convert CSS px → VIDEO px correctly
   (object-fit math!). Call `judge.calibrate(taps)`. Then draw the court overlay using
   `engine.groundToImage` over `courtLineSegments()`. Show reprojection RMS. **Block Play** if
   `!poseValid` or `reprojRmsPx > 3` with a specific fix message. Warn if `status.cameraHeightM < 2.0`.
4. **Play**: big verdict banner per `onCall`: `IN` / `OUT` / `FAULT` with "34 mm past the sideline",
   and `TOO CLOSE — 71% in` for NO_CALL. Rally/serve toggle → `judge.setContext`. Reset point
   button → `judge.resetPlay()`. Thin status strip: fps, detect ms, timeSource, clock state.
5. **Summary**: calls made / declined, list of last 20 calls.
Must use only the public API of `web/src/core` (Judge, Engine, Camera, court, types).
Test path without a phone: Chrome with `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<clip.y4m>`
(clips from PJ-VAL-01; until then any y4m works).
Acceptance: on desktop Chrome with a fake camera the whole flow runs end to end and produces calls;
`npm run check` green; the Vercel preview URL for the branch is written in this task's Status cell.

### PJ-NET-01 — pairing + transport (antigravity · Opus 5)
`web/src/net/`: implement `Transport` from `types.ts` twice:
- `WebRtcTransport`: two DataChannels — `sync` (ordered:false, maxRetransmits:0) for SYNC_*,
  `data` (reliable) for everything else. STUN `stun:stun.l.google.com:19302`. Handler invoked
  synchronously from `onmessage` (contract!).
- `RelayTransport`: Supabase Realtime **broadcast** on channel `pj-<room>`; used when ICE does not
  connect within 8 s (courts often have no Wi-Fi; both phones on 4G behind CGNAT).
- Signaling: Supabase Realtime broadcast on `pj-signal-<room>`; room = 6-digit code shown big + as QR
  (`qrcode`), joined by typing it or scanning (`jsqr` on camera frames). One code, no accounts.
- Dual flow in UI: Two phones → host/join → paired (show `p2p` or `relay`) → each phone calibrates →
  Play. `judge.attachTransport(t)`. Show peer calibration state from `CALIBRATED` messages.
Unit tests with an in-memory loopback Transport (`web/test/net-*.test.ts`).
Acceptance: two desktop Chrome windows pair on the Vercel preview and show clock locked within 15 s;
relay fallback forced with a `?forceRelay=1` flag works.

### PJ-UI-02 — PWA polish (antigravity · 3.8 Flash)
Manifest + icons (generate a simple original mark — no trademarked imagery), `sw.js` offline app
shell (cache-first for /assets and /pbj_engine.wasm, network-first for HTML), install prompt,
`keepAwake()` during Play, spoken calls via `speechSynthesis` ("Out", "In", "Too close, seventy-one
percent in"), haptic `navigator.vibrate` on OUT/FAULT. Acceptance: Lighthouse PWA installable.

### PJ-VAL-01 — synthetic court video (gemini · 3.8 Flash)
`tools/synth-video/`: Node/TS CLI reusing the math in `web/test/synth.ts` (import it; do not copy-edit)
that renders **y4m (YUV4MPEG2, 4:2:0)** clips + `<clip>.truth.json` containing camera rig, calibration
taps (exact projections), and every bounce `{t, x, y, verdict, nearestLine, marginM}`.
Scenarios (720p60 and 1080p60): `clear_in`, `clear_out`, `line_clip` (±10 mm), `serve_kitchen_fault`,
`yellow_lines`, `shirt_distractor`, `second_ball_rolling`, `exposure_step` (global +15% brightness at t=1 s),
plus a matching `rigB` clip for each (same physics, other camera) for dual tests.
Acceptance: `node tools/synth-video/render.ts --all` produces the clips (<300 MB total, gitignored
under `tools/synth-video/out/`), and Chrome plays them as a fake camera.

### PJ-VAL-02 — browser E2E harness (gemini · 3.1 Pro)
`web/harness.html` + `web/src/harness/`: loads `Judge` with a real `Camera` (fed by Chrome's fake
device), calibrates from `?truth=<url>`, records every LineCall into `window.__pj`.
`e2e/`: Playwright runs Chromium with the fake-camera flags per clip, waits for completion, scores
calls against truth (position error, verdict accuracy, confident-wrong count), writes
`e2e/report.json` + markdown table. `.github/workflows/e2e.yml`: renders clips, runs the suite,
uploads the report artifact (non-blocking for now).
Acceptance: GL detector path (not CPU fallback) runs in headless Chromium; report produced in CI;
zero confident-wrong calls on `clear_in`/`clear_out`.

### PJ-VAL-03 — field session logger (gemini · 3.8 Flash)
`web/src/debug/`: an overlay (`?debug=1` on the app) that, after each call, lets the operator type the
tape-measured truth (x, y, verdict) and appends a row; export CSV exactly matching
`tools/validation/score_validation.py` columns. Also overlays the detector mask (`detector.lastMask`).

### PJ-OPS-02 — watchdog (hermes)
Every 2 h (Hermes scheduler / cron on the home machine): `bash tools/agent/status.sh`, newest open
GitHub issues titled `integrate FAILED`, newest rows in Supabase `device_reports`, Vercel latest
deployment state. Send ONE Telegram digest: what landed, what failed (with the fix the issue names),
which agent is idle, and any yes/no question for the human. Silent if nothing changed.
Commit the script to `ops/watchdog/`.

### PJ-OPS-03 — store pages + listing assets (hermes)
`web/public/privacy.html` and `support.html` from `docs/PRIVACY_POLICY.md` (fill placeholders with
TODO markers where only the human knows the answer). Screenshot set via Playwright device emulation
of the harness (6.9" iPhone 1320×2868, Android phone 1080×2400) into `ops/store/screenshots/`.

### PJ-CORE-02 — device gate decision (claude)
Read both phones' spike reports from Supabase; decide per `docs/DECISION.md` §Kill criteria whether the
web camera path holds on iOS and Android; if iOS fails G1/G3, scope the Capacitor native-camera plugin.

### PJ-CORE-03 — detector tuning on E2E + real clips (claude)
Use VAL-02 reports and any real clips to tune thresholds, add exposure-change handling, rolling-shutter
estimate, and make the reported σ honest (FIELD_VALIDATION gate G5).

### PJ-MOB-01 — Capacitor wrapper (antigravity, on the M3 Max Mac)
`mobile/`: Capacitor 7 project pointing at `web/dist`, iOS + Android, camera + local-network usage
strings from `docs/NATIVE_BUILD_CONFIG.md`, privacy manifest from `docs/PrivacyInfo.xcprivacy`,
targetSdk 36, Xcode 26. Builds only; store upload waits for H-03.

## Environments
(PJ-OPS-01 fills this in)
- Production: https://picklejudge.vercel.app  (device check: https://picklejudge.vercel.app/spike.html)
- Preview pattern: `vercel deploy` from `web/` → https://picklejudge-<hash>-hansalpersonalai-7040s-projects.vercel.app
  (Git auto-deploy NOT connected: Vercel account is not linked to GitHub account frcrcfaculty-commits;
  until it is, deploy with `cd web && vercel deploy --prod`.)
- Supabase project ref: eyxeougwbdtblwfpqjbs (ap-south-1, free). Table `device_reports`, RLS on, no policies;
  writes only via SECURITY DEFINER rpc `submit_device_report` (64 KB cap). No service-role key used anywhere.
- Vercel env (all envs): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (server), VITE_REPORT_URL=/api/report

## Requests (cross-ownership changes)
| From | To | Request | Status |
|---|---|---|---|
