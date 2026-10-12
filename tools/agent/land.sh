#!/usr/bin/env bash
# land.sh — the ONLY way any agent finishes a task.
#
#   bash tools/agent/land.sh <TASK-ID>
#
# It refuses to report success until your commit is provably ON main.
# Steps:
#   1. sanity: you are on agent/<agent>/<TASK-ID>-*, tree clean, task id in
#      at least one commit message
#   2. rebase onto the latest origin/main (conflicts surface HERE, locally)
#   3. run the same checks the integrator will run (web: npm run check;
#      engine: ctest) so you do not burn a CI round-trip on a known failure
#   4. push the branch → .github/workflows/integrate.yml merges it into main
#   5. poll origin until  HEAD ∈ main  (LANDED, exit 0)
#      or an integrate-failed/<branch>/<sha> tag appears (FAILED, exit 2)
#      or 25 minutes pass (TIMEOUT, exit 3)
#
# Exit 0 is the definition of "done". Anything else means the task is NOT
# done, regardless of what was written or committed.

set -uo pipefail
TASK="${1:-}"
[[ -z "$TASK" ]] && { echo "usage: bash tools/agent/land.sh <TASK-ID>"; exit 64; }

ROOT="$(git rev-parse --show-toplevel)" || exit 64
cd "$ROOT"
BR="$(git rev-parse --abbrev-ref HEAD)"
red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }

# ---- 1. sanity -------------------------------------------------------------
if [[ ! "$BR" =~ ^agent/[a-z0-9-]+/${TASK}(-[a-z0-9-]+)?$ ]]; then
  red "WRONG BRANCH: '$BR'. Expected agent/<agent>/${TASK}-<slug> (see AGENTS.md)."
  exit 65
fi
if [[ -n "$(git status --porcelain)" ]]; then
  red "UNCOMMITTED CHANGES. Commit them (message must contain ${TASK}) and re-run."
  git status --short
  exit 65
fi
git fetch -q origin main || { red "cannot fetch origin/main"; exit 66; }
if ! git log --format=%s origin/main..HEAD | grep -q "$TASK"; then
  red "No commit on this branch mentions ${TASK}. Nothing to land, or wrong branch."
  exit 65
fi

# ---- 2. rebase -------------------------------------------------------------
if ! git rebase -q origin/main; then
  red "REBASE CONFLICT with main. Resolve the files listed by 'git status',"
  red "then: git add <files> && git rebase --continue && bash tools/agent/land.sh ${TASK}"
  exit 67
fi

# ---- 3. local checks (same as the integrator) -------------------------------
CHANGED="$(git diff --name-only origin/main...HEAD)"
if echo "$CHANGED" | grep -q '^engine/'; then
  echo "• engine changed → C++ tests"
  cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release >/dev/null &&
    cmake --build engine/build -j >/dev/null &&
    ./engine/build/pbj_tests | tail -1 || { red "ENGINE TESTS FAILED"; exit 68; }
fi
if echo "$CHANGED" | grep -q '^web/'; then
  echo "• web changed → npm run check"
  ( cd web && { [[ -d node_modules ]] || npm ci --no-audit --no-fund; } && npm run check ) ||
    { red "WEB CHECKS FAILED (typecheck / tests / build). Fix before landing."; exit 68; }
fi

# ---- 4. push ---------------------------------------------------------------
HEAD_SHA="$(git rev-parse HEAD)"
SHORT="${HEAD_SHA:0:8}"
git push -q --force-with-lease origin "HEAD:refs/heads/$BR" || { red "PUSH FAILED"; exit 66; }
echo "• pushed $BR @ $SHORT — integrator is merging (typically 3–6 min)…"

# ---- 5. wait for proof -----------------------------------------------------
FAILTAG="integrate-failed/${BR#agent/}/${SHORT}"
for i in $(seq 1 100); do
  sleep 15
  git fetch -q origin main 2>/dev/null
  if git merge-base --is-ancestor "$HEAD_SHA" origin/main; then
    grn "LANDED: ${TASK} (${SHORT}) is on main."
    git log --oneline -1 origin/main
    exit 0
  fi
  if git ls-remote --tags origin "refs/tags/${FAILTAG}" | grep -q .; then
    red "INTEGRATE FAILED for ${TASK} (${SHORT})."
    red "Open the newest GitHub issue titled 'integrate FAILED: ${BR}' for the log,"
    red "fix on this same branch, commit, and run land.sh again."
    exit 2
  fi
  (( i % 4 == 0 )) && echo "  …still integrating ($((i/4)) min)"
done
red "TIMEOUT: not on main after 25 min. Check the Actions tab for the 'integrate' run of ${BR}."
exit 3
