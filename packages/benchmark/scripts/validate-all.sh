#!/usr/bin/env bash
#
# Validate every SlopBench task's reference solution end-to-end (no Docker):
# each task's clean solution must pass its functional gate and earn reward > 0.
# Run this before publishing a benchmark release (CI job with network, since
# vitest-based tasks install their dev deps).
#
# Usage: scripts/validate-all.sh
set -uo pipefail

BENCH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=()
COUNT=0

for task_toml in "$BENCH_ROOT"/tasks/*/task.toml; do
  task_dir="$(dirname "$task_toml")"
  name="$(basename "$task_dir")"
  case "$name" in
    _template | _base) continue ;;
  esac
  COUNT=$((COUNT + 1))
  echo "::: validating $name"
  if bash "$BENCH_ROOT/scripts/validate-task.sh" "$task_dir" --expect-pass >/tmp/slopbench-validate-"$name".log 2>&1; then
    tail -3 /tmp/slopbench-validate-"$name".log | sed 's/^/    /'
  else
    echo "    FAILED — see /tmp/slopbench-validate-$name.log"
    tail -6 /tmp/slopbench-validate-"$name".log | sed 's/^/    /'
    FAILED+=("$name")
  fi
done

echo
if [ "${#FAILED[@]}" -ne 0 ]; then
  echo "VALIDATE-ALL: ${#FAILED[@]}/$COUNT task(s) FAILED: ${FAILED[*]}"
  exit 1
fi
echo "VALIDATE-ALL: all $COUNT task reference solutions pass + score reward>0"
