# AGENTS.md — rules every agent follows, no exceptions

Repository: **https://github.com/frcrcfaculty-commits/PickleBall** (canonical lowercase:
`frcrcfaculty-commits/pickleball`; both URLs work)
Default / integration branch: **`main`**. Nothing else is ever "the" branch.

## The one rule

**A task is done when `bash tools/agent/land.sh <TASK-ID>` prints `LANDED`. Not before.**
Writing code, committing, pushing, opening a PR, or saying "done" does not count.
If land.sh does not print LANDED, report the exact output and stop — do not claim completion.

## Workflow (copy exactly)

```bash
# 0. once per machine
git clone https://github.com/frcrcfaculty-commits/PickleBall.git pickleball   # skip if present
cd pickleball
git fetch origin && git checkout main && git reset --hard origin/main         # fresh main

# 1. start the task — creates agent/<agent>/<TASK-ID>-<slug> from LATEST origin/main
bash tools/agent/start.sh <agent> <TASK-ID> <slug>

# 2. work. Commit often. EVERY commit message starts with the task id:
git add -A && git commit -m "<TASK-ID>: <what changed>"

# 3. land — rebases, runs checks, pushes, waits until the commit is ON main
bash tools/agent/land.sh <TASK-ID>
```

How landing works: `.github/workflows/integrate.yml` merges any pushed `agent/**`
branch into `main` **automatically** if the merged result passes engine tests,
typecheck, unit tests and build. No PR. No human merge. land.sh waits for proof
(`git merge-base --is-ancestor HEAD origin/main`). On failure the integrator
opens a GitHub issue titled `integrate FAILED: <branch>` and land.sh exits 2.

### Forbidden

- Pushing to `main` directly. Working on `main`. Branches not named `agent/<agent>/<TASK-ID>-<slug>`.
- Committing to another agent's branch, or basing your branch on one.
- Editing files outside your ownership list below. Need a change there? Add a row
  to TASKS.md §Requests and land that alone; the owner picks it up.
- Adding npm dependencies. Everything known to be needed is pre-installed
  (`@supabase/supabase-js`, `qrcode`, `jsqr`, `@playwright/test`). Lockfile
  conflicts between agents are the #1 way parallel work fails to merge.
- `git push --force` to anything except your own branch (land.sh uses
  `--force-with-lease` on your branch after rebasing; that is the only force).
- Committing secrets. Keys go in Vercel/Supabase env, never in the repo.
- Leaving work uncommitted at the end of a session. If you must stop early:
  commit with `<TASK-ID>: WIP <what is left>`, push the branch
  (`git push -u origin HEAD`), and write the exact remaining steps in TASKS.md.

## Asking the human for anything

The human only monitors. If something truly needs them (a login, a phone in hand, a payment), write it
as numbered steps a 5-year-old could follow: every click, every exact command in a code block, what they
should see, and what to do if it looks different — in the style of `docs/agents/HUMAN_STEPS.md`.
Never a one-line "please configure X". Ask once, batch everything into one message.

## Ownership (directories each agent may edit)

### claude — core engine, detector, contracts, CI (heavy algorithmic work)
- `engine/**`
- `web/src/core/**`, `web/src/spike/**`, `web/spike.html`
- `web/test/engine.test.ts`, `web/test/detector.test.ts`, `web/test/pipeline.test.ts`, `web/test/synth.ts`
- `web/vite.config.ts`, `web/tsconfig.json`, `web/package.json`, `web/package-lock.json`
- `.github/**` (except `.github/workflows/e2e.yml`), `tools/agent/**`
- `AGENTS.md`, `docs/DECISION.md`, `docs/ARCHITECTURE.md`, `docs/agents/**`

### antigravity — app UI, pairing, transport, PWA
- `web/index.html`, `web/src/ui/**`, `web/src/net/**`, `web/src/sw.ts`
- `web/public/manifest.webmanifest`, `web/public/icons/**`, `web/public/sw.js`
- `web/test/ui-*.test.ts`, `web/test/net-*.test.ts`
- `mobile/**` (Capacitor wrapper, later phase)

### gemini — synthetic video, E2E harness, validation tooling, debug logger
- `tools/synth-video/**`, `tools/validation/**`
- `web/harness.html`, `web/src/harness/**`, `web/src/debug/**`
- `e2e/**`, `.github/workflows/e2e.yml`
- `web/test/val-*.test.ts`

### hermes — deploy, backend glue, monitoring, store paperwork
- `web/api/**`, `web/vercel.json`, `vercel.json`
- `ops/**`, `docs/OPS.md`, `docs/STORE_LISTING.md`, `docs/PRIVACY_POLICY.md`
- `web/public/privacy.html`, `web/public/support.html`

### shared (edit ONLY your own rows)
- `TASKS.md`

## Contracts you code against (do not redefine)

- `web/src/core/types.ts` — LineCall, WireContact, PeerMessage, **Transport** interface, coordinate frame, timebase.
- `web/src/core/judge.ts` — `Judge`: the single object the UI drives (calibrate, setContext, attachTransport, start/stop, events).
- `web/src/core/engine.ts` — wasm engine wrapper. `web/public/pbj_engine.wasm` is rebuilt by CI; never edit it by hand.
- Units: metres, net-centred court frame. Time: `performance.now()/1000` seconds everywhere.

## Commands

```bash
cd web && npm ci            # install (exact lockfile)
npm run dev                 # https needed for camera on phones: use the Vercel preview URL instead
npm run check               # typecheck + unit tests + build  (what the integrator runs)
cd ../engine && cmake -B build && cmake --build build && ./build/pbj_tests   # C++ ground truth
bash tools/agent/status.sh  # what landed, what is stuck
```
