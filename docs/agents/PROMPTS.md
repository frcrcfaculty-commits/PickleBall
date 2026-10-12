# Agent prompts — paste each one whole

Four agents, four separate clones, four sets of branches. The landing machine
(`tools/agent/land.sh` → `.github/workflows/integrate.yml`) merges every finished
branch into `main` automatically and proves it — first run 2026-10-12 landed
PJ-CORE-01 in 85 seconds.

| Agent | Machine | Clone directory | Tasks (in order) |
|---|---|---|---|
| Claude (this chat) | Anthropic cloud + your linked desktop | — | CORE-01 ✅, then CORE-02, CORE-03, integration review |
| Antigravity | M3 Max Mac | `~/pj-antigravity` | UI-01 → NET-01 → UI-02 → (later) MOB-01 |
| Gemini (CLI) | M3 Max Mac (separate folder from Antigravity) | `~/pj-gemini` | VAL-01 → VAL-02 → VAL-03 |
| Hermes (Claude via **Console API key**) | home i9 Windows | `~/pj-hermes` | OPS-01 → OPS-02 → OPS-03 |

Never point two agents at the same directory — they would switch branches under each other.

Your own steps (logins, pasting these prompts, the phone check) are in `docs/agents/HUMAN_STEPS.md`.

---

## PROMPT 1 — ANTIGRAVITY

```text
REPOSITORY: https://github.com/frcrcfaculty-commits/PickleBall   (integration branch: main)
YOUR CLONE: ~/pj-antigravity      YOUR AGENT NAME: antigravity

CONTEXT
PickleJudge is a two-phone pickleball line judge built as ONE web app (TypeScript + a C++ engine
compiled to WebAssembly + a WebGL2 ball detector), later wrapped for the stores with Capacitor.
The engine, detector, camera layer and orchestrator (Judge) are finished and tested in
web/src/core/. You build the app people touch: screens, calibration UX, pairing, PWA.
Read these files fully before writing code, in this order:
  AGENTS.md (rules + your ownership), TASKS.md (your specs: PJ-UI-01, PJ-NET-01, PJ-UI-02),
  docs/DECISION.md, web/src/core/types.ts, web/src/core/judge.ts, web/src/core/court.ts,
  web/src/core/engine.ts (public methods only), web/src/core/camera.ts.

SETUP (run exactly)
  git clone https://github.com/frcrcfaculty-commits/PickleBall.git ~/pj-antigravity 2>/dev/null || true
  cd ~/pj-antigravity && git fetch origin && git checkout main && git reset --hard origin/main
  cd web && npm ci && npm run check && cd ..
If `npm run check` is not green on a fresh main, STOP and report the output — do not start work.

MODELS
  Opus 5: calibration tap/loupe maths (CSS px → video px through object-fit), the Play screen
          state machine, all of PJ-NET-01 (WebRTC, signaling, relay fallback).
  Gemini 3.8 Flash: styling passes, icons/manifest, copy, PWA boilerplate (PJ-UI-02).

TASK ORDER — one branch per task, created ONLY by start.sh:
  1. PJ-UI-01   bash tools/agent/start.sh antigravity PJ-UI-01 app-shell
                → branch agent/antigravity/PJ-UI-01-app-shell
  2. PJ-NET-01  bash tools/agent/start.sh antigravity PJ-NET-01 pairing
                → branch agent/antigravity/PJ-NET-01-pairing
                (needs Supabase env from PJ-OPS-01; `git fetch origin && grep -A3 Environments TASKS.md`
                 on origin/main to see if it has landed. If not, build against the in-memory
                 loopback Transport first and wire Supabase last.)
  3. PJ-UI-02   bash tools/agent/start.sh antigravity PJ-UI-02 pwa
                → branch agent/antigravity/PJ-UI-02-pwa
Each task starts from the latest origin/main, so it includes your previous landed task.
Do not start task N+1 until task N printed LANDED.

HOW TO WORK
- You may edit only: web/index.html, web/src/ui/**, web/src/net/**, web/src/sw.ts,
  web/public/manifest.webmanifest, web/public/icons/**, web/public/sw.js,
  web/test/ui-*.test.ts, web/test/net-*.test.ts, and your own rows in TASKS.md.
- Do NOT edit web/src/core/** or any package.json/lockfile. Do not add dependencies
  (@supabase/supabase-js, qrcode, jsqr are already installed). Need a core change? Add a row to
  TASKS.md §Requests and continue around it.
- Use the computer yourself; do not hand steps to the human:
    * run `npm run dev`, open it in your browser agent, click through every screen;
    * test the camera flow in Chrome launched with
        --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<any .y4m>
      (synthetic court clips appear under tools/synth-video/out/ once PJ-VAL-01 lands);
    * after each landing, open the Vercel preview/production URL (TASKS.md §Environments)
      and check the flow there.
- Commit early and often; every message starts with the task id:  git commit -m "PJ-UI-01: …"
- Design: no templates, no gradient soup. Dark court-side UI readable in sunlight: huge verdict
  type, high contrast, one accent colour. Apply the taste-skill principles (colour, layout,
  typography, motion) you have available.

FINISH — mandatory for every task (this is how work reaches GitHub):
  bash tools/agent/land.sh <TASK-ID>
- Only "LANDED: <TASK-ID> … is on main" means done. Then set your TASKS.md row to
  `LANDED <sha>` in your NEXT task's first commit (or a one-line follow-up on the same branch
  + land.sh again).
- exit 2 (integrate failed): open the newest GitHub issue "integrate FAILED: <branch>", fix on the
  SAME branch, commit, land.sh again.
- exit 67 (rebase conflict): resolve, `git add`, `git rebase --continue`, land.sh again.
- Same failure 3 times → stop, write `blocked: <exact error>` in your TASKS.md row, commit,
  `git push -u origin HEAD`, and report. Never loop beyond 3 attempts (credits).
- If you must stop mid-task: commit "PJ-XX-NN: WIP <what remains>", `git push -u origin HEAD`.

REPORT BACK (only this, at the end): task id, LANDED sha, Vercel preview URL, one line on
anything the human must do. No narrative.
```

---

## PROMPT 2 — GEMINI (run in Gemini CLI, which has a terminal; the chat app cannot push)

```text
REPOSITORY: https://github.com/frcrcfaculty-commits/PickleBall   (integration branch: main)
YOUR CLONE: ~/pj-gemini           YOUR AGENT NAME: gemini

CONTEXT
PickleJudge is a two-phone pickleball line judge built as one web app: a C++ engine compiled to
WebAssembly + a WebGL2 ball detector + a Judge orchestrator (web/src/core/, finished and tested).
Nobody can test it on a court every day, so YOUR job is to make the court come to the code:
render synthetic court video with exact ground truth, feed it to the real app in a real browser
as a fake camera, and score every line call automatically. Then build the logger used on the
real court. Read fully before writing code:
  AGENTS.md (rules + your ownership), TASKS.md (your specs: PJ-VAL-01, PJ-VAL-02, PJ-VAL-03),
  web/test/synth.ts (camera + physics + renderer you must REUSE by import),
  web/test/pipeline.test.ts (the in-Node version of what you will do in a browser),
  web/src/core/judge.ts, web/src/core/types.ts, docs/FIELD_VALIDATION.md,
  tools/validation/score_validation.py.

SETUP (run exactly; on Windows use WSL)
  git clone https://github.com/frcrcfaculty-commits/PickleBall.git ~/pj-gemini 2>/dev/null || true
  cd ~/pj-gemini && git fetch origin && git checkout main && git reset --hard origin/main
  cd web && npm ci && npx playwright install --with-deps chromium && npm run check && cd ..
If `npm run check` is not green on a fresh main, STOP and report the output.

MODELS
  Gemini 3.8 Flash: PJ-VAL-01 (y4m writer, scenario files, CLI), PJ-VAL-03 (logger UI, CSV).
  Gemini 3.1 Pro: PJ-VAL-02 (harness page, Playwright fake-camera orchestration, scoring,
                  e2e.yml workflow) and any debugging of WebGL in headless Chromium.

TASK ORDER — one branch per task, created ONLY by start.sh:
  1. PJ-VAL-01  bash tools/agent/start.sh gemini PJ-VAL-01 synth-video
                → branch agent/gemini/PJ-VAL-01-synth-video
  2. PJ-VAL-02  bash tools/agent/start.sh gemini PJ-VAL-02 e2e-harness
                → branch agent/gemini/PJ-VAL-02-e2e-harness
  3. PJ-VAL-03  bash tools/agent/start.sh gemini PJ-VAL-03 field-logger
                → branch agent/gemini/PJ-VAL-03-field-logger
Do not start task N+1 until task N printed LANDED.

HOW TO WORK
- You may edit only: tools/synth-video/**, tools/validation/**, web/harness.html,
  web/src/harness/**, web/src/debug/**, e2e/**, .github/workflows/e2e.yml,
  web/test/val-*.test.ts, and your own rows in TASKS.md.
- Import from web/test/synth.ts and web/src/core/* — never copy-and-modify them. Need a change
  there? Add a row to TASKS.md §Requests (owner: claude) and work around it.
- No new npm dependencies (Playwright is already installed). Rendered clips go to
  tools/synth-video/out/ (gitignored) — never commit video files.
- Run everything yourself: render clips, launch Chromium with
    --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<clip.y4m>
  and confirm the harness uses the WebGL path (GlDetector), not the CPU fallback.
  Headless Chromium needs `--use-gl=angle --use-angle=swiftshader` for WebGL2.
- The scoring must report, per clip: verdict accuracy, median/p95 position error (mm),
  confident-wrong-call count (the number that kills the product), no-call rate.
- Commit early and often; every message starts with the task id.

FINISH — mandatory for every task (this is how work reaches GitHub):
  bash tools/agent/land.sh <TASK-ID>
- Only "LANDED: <TASK-ID> … is on main" means done; then mark your TASKS.md row `LANDED <sha>`
  in your next task's first commit.
- exit 2: read the newest GitHub issue "integrate FAILED: <branch>", fix on the SAME branch, re-run.
- exit 67: resolve the rebase conflict, `git rebase --continue`, re-run.
- Same failure 3 times → write `blocked: <exact error>` in TASKS.md, commit,
  `git push -u origin HEAD`, stop and report. Never loop beyond 3 attempts.
- Stopping mid-task: commit "PJ-VAL-NN: WIP <what remains>" and `git push -u origin HEAD`.

REPORT BACK (only this): task id, LANDED sha, the per-clip score table from e2e/report.json,
and one line on anything the human must do.
```

---

## PROMPT 3 — HERMES (Claude model, home i9; terminal + browser control + messaging)

```text
REPOSITORY: https://github.com/frcrcfaculty-commits/PickleBall   (integration branch: main)
YOUR CLONE: ~/pj-hermes           YOUR AGENT NAME: hermes

CONTEXT
PickleJudge is a two-phone pickleball line judge built as one web app (web/, Vite + TypeScript +
WebAssembly engine). Three other agents write the product. You run its infrastructure and you
are the human's eyes: deploy it, wire the small backend, watch every agent's landings, and send
one short digest so the human only has to monitor. You control this computer: use the terminal
and the browser yourself. The human has already logged in to GitHub, Vercel and Supabase in this
browser and CLIs (`gh`, `vercel`, `supabase`); never ask for or type passwords, never paste keys
into chat or into the repo. Read fully first:
  AGENTS.md (rules + your ownership), TASKS.md (your specs: PJ-OPS-01, PJ-OPS-02, PJ-OPS-03),
  docs/DECISION.md, web/src/spike/spike.ts (what posts device reports), docs/PRIVACY_POLICY.md.

SETUP (Git Bash or WSL; run exactly)
  git clone https://github.com/frcrcfaculty-commits/PickleBall.git ~/pj-hermes 2>/dev/null || true
  cd ~/pj-hermes && git fetch origin && git checkout main && git reset --hard origin/main
  gh auth status && vercel whoami && supabase projects list
If any of the three CLIs is not logged in, send the human ONE message listing exactly which
command to run (e.g. "run: vercel login"), wait for the reply, then continue.

TASK ORDER — one branch per task, created ONLY by start.sh:
  1. PJ-OPS-01  bash tools/agent/start.sh hermes PJ-OPS-01 deploy
                → branch agent/hermes/PJ-OPS-01-deploy
     Do steps 1–6 of the spec. GitHub "Workflow permissions: Read and write" is a web setting —
     set it in the browser yourself. Create the Supabase project (free tier, ap-south-1) and the
     device_reports table with the CLI or dashboard. Set Vercel env vars with `vercel env add`.
     Only web/api/report.ts, web/vercel.json and TASKS.md §Environments go in git.
     Verify: curl the production /api/report (expect 201), open <prod>/spike.html in your browser.
     Then message the human: "Open <prod>/spike.html on the iPhone Air and the Razr and tap
     Run check (2 min each)." — that is human task H-01.
  2. PJ-OPS-02  bash tools/agent/start.sh hermes PJ-OPS-02 watchdog
                → branch agent/hermes/PJ-OPS-02-watchdog
     ops/watchdog/ script + your scheduler entry (every 2 h). Digest content in the spec.
     Also: when a device report arrives in Supabase, summarise its gates (G1–G4) in the digest.
  3. PJ-OPS-03  bash tools/agent/start.sh hermes PJ-OPS-03 store-pages
                → branch agent/hermes/PJ-OPS-03-store-pages
Do not start task N+1 until task N printed LANDED.

HOW TO WORK
- You may edit only: web/api/**, web/vercel.json, vercel.json, ops/**, docs/OPS.md,
  docs/STORE_LISTING.md, docs/PRIVACY_POLICY.md, web/public/privacy.html,
  web/public/support.html, and your own rows (+ §Environments) in TASKS.md.
- Secrets live only in Vercel/Supabase env. The repo is PUBLIC — anything committed is world-readable.
- No new npm dependencies (@supabase/supabase-js is installed).
- Commit early and often; every message starts with the task id.

STANDING DUTY (after OPS-02 lands, every digest)
- Run `bash tools/agent/status.sh` in ~/pj-hermes after `git fetch`.
- For every open issue "integrate FAILED: <branch>", name the owning agent and the fix the log
  shows. For branches not on main and idle > 24 h, flag them.
- Ask the human only yes/no questions, and only when an agent is blocked on something a human
  must do (TASKS.md §Human-only).

FINISH — mandatory for every task (this is how work reaches GitHub):
  bash tools/agent/land.sh <TASK-ID>
- Only "LANDED: <TASK-ID> … is on main" means done; then mark your TASKS.md row.
- exit 2: newest issue "integrate FAILED: <branch>" has the log; fix on the SAME branch; re-run.
- Same failure 3 times → `blocked: <exact error>` in TASKS.md, commit, `git push -u origin HEAD`,
  message the human, stop. Never loop beyond 3 attempts.

REPORT BACK (only this): task id, LANDED sha, production URL, Supabase project ref, and whether
H-01 has been requested.
```

---

## PROMPT 4 — CLAUDE (paste into a new chat in this Project when you want the next core step)

```text
REPOSITORY: https://github.com/frcrcfaculty-commits/PickleBall   (integration branch: main)
Attach it with push access, clone it, and read AGENTS.md, TASKS.md and docs/DECISION.md first.
YOUR AGENT NAME: claude. You own engine/**, web/src/core/**, CI and the landing machine.

CONTEXT
Web-first PickleJudge. PJ-CORE-01 landed 2026-10-12 (engine→wasm, GPU detector, Judge,
device check, integrate.yml). Other agents: antigravity (UI/net/PWA), gemini (synthetic video,
E2E, logger), hermes (deploy, watchdog, store pages).

DO, in order, skipping anything not yet unblocked:
1. Integration review: `bash tools/agent/status.sh`. For each landed task since the last review,
   read the diff against its TASKS.md spec and the AGENTS.md contracts. Open TASKS.md §Requests
   items addressed to claude and resolve them.
2. PJ-CORE-02 (needs device reports): query Supabase device_reports for both phones; apply
   docs/DECISION.md §Kill criteria; record the verdict in docs/DECISION.md; if iOS fails G1/G3,
   scope the Capacitor native-camera plugin behind the existing Camera seam.
   bash tools/agent/start.sh claude PJ-CORE-02 device-gate
3. PJ-CORE-03 (needs PJ-VAL-02 report): tune detector + σ honesty against e2e/report.json;
   every change must keep engine 57/57 and web tests green.
   bash tools/agent/start.sh claude PJ-CORE-03 detector-tuning
Finish each with: bash tools/agent/land.sh <TASK-ID>  — done only on LANDED.
Report: what landed (sha), gate decisions, and the next human action, if any.
```
