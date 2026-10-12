#!/usr/bin/env bash
# start.sh — the ONLY way any agent begins a task.
#
#   bash tools/agent/start.sh <agent> <TASK-ID> <slug>
#   e.g. bash tools/agent/start.sh antigravity PJ-UI-01 app-shell
#
# Creates agent/<agent>/<TASK-ID>-<slug> from the LATEST origin/main (never
# from a stale local main, never from another agent's branch), and prints the
# directories this agent owns. Re-running on an existing branch just rebases it.
set -euo pipefail
AGENT="${1:-}"; TASK="${2:-}"; SLUG="${3:-work}"
case "$AGENT" in claude|antigravity|hermes|gemini) ;; *)
  echo "agent must be one of: claude antigravity hermes gemini"; exit 64;; esac
[[ "$TASK" =~ ^PJ-[A-Z]+-[0-9]+$ ]] || { echo "TASK-ID must look like PJ-UI-01"; exit 64; }
cd "$(git rev-parse --show-toplevel)"
BR="agent/${AGENT}/${TASK}-${SLUG}"
git fetch -q origin main
if git show-ref --verify -q "refs/heads/$BR"; then
  git checkout -q "$BR"
  git rebase -q origin/main
else
  git checkout -q -b "$BR" origin/main
fi
git config user.name  >/dev/null || git config user.name  "$AGENT-agent"
git config user.email >/dev/null || git config user.email "$AGENT-agent@users.noreply.github.com"
echo "On branch: $BR  (based on origin/main @ $(git rev-parse --short origin/main))"
echo "You own (see AGENTS.md §Ownership):"
awk -v a="$AGENT" '$0 ~ "^### "a {f=1; next} /^### /{f=0} f && /^- `/' AGENTS.md
