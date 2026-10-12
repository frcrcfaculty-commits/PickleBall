#!/usr/bin/env bash
# status.sh — one-screen project status for the human or the watchdog agent.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
git fetch -q origin '+refs/heads/*:refs/remotes/origin/*' --tags --prune 2>/dev/null
echo "== main @ $(git rev-parse --short origin/main) — last 8 landings =="
git log origin/main --merges --format='  %ad  %s' --date=format:'%m-%d %H:%M' -8
echo
echo "== agent branches NOT yet on main =="
for r in $(git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/agent/'); do
  if ! git merge-base --is-ancestor "$r" origin/main; then
    echo "  ${r#origin/}  ($(git log -1 --format='%cr' "$r"))"
  fi
done
echo
echo "== integrate failures (most recent 5) =="
git tag -l 'integrate-failed/*' --sort=-creatordate | head -5 | sed 's/^/  /'
echo
echo "== task ledger =="
sed -n '/^| ID/,/^$/p' TASKS.md
