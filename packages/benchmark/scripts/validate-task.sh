#!/usr/bin/env bash
#
# Locally validate one SlopBench task WITHOUT Docker, by simulating the sandbox:
#   seed/ -> git repo (root commit = BASE) -> apply a patch (the "agent") ->
#   run the task's tests/test.sh through the shared grader -> inspect reward.
#
# Usage:
#   scripts/validate-task.sh <task-dir> [--patch solution|<path>] [--expect-pass|--expect-fail]
#
# Defaults to applying the task's reference solution and expecting a passing,
# high-scoring run. Pass `--patch <file>` to grade an alternative (e.g. sloppy)
# diff. Requires the workspace react-doctor + slop-verify to be built.
set -euo pipefail

BENCH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_DIR="$(cd "$1" && pwd)"; shift
PATCH="solution"
EXPECT="pass"
while [ $# -gt 0 ]; do
  case "$1" in
    --patch) PATCH="$2"; shift 2 ;;
    --expect-pass) EXPECT="pass"; shift ;;
    --expect-fail) EXPECT="fail"; shift ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

RD_BIN="${RD_BIN:-$BENCH_ROOT/node_modules/.bin/react-doctor}"
SV_BIN="${SV_BIN:-$BENCH_ROOT/bin/slop-verify.js}"
[ -f "$BENCH_ROOT/dist/index.mjs" ] || { echo "build the verifier first: pnpm --filter @react-doctor/benchmark build"; exit 3; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/app"; LOGS="$WORK/logs"; BIN="$WORK/bin"
mkdir -p "$APP" "$LOGS" "$BIN"

cp -a "$TASK_DIR/seed/." "$APP/"
cd "$APP"
git init -q && git config user.email t@t.co && git config user.name t
git add -A && git commit -qm base >/dev/null

if [ "${INSTALL:-auto}" != "skip" ] && [ -f package.json ] && grep -q '"vitest"' package.json; then
  echo "[validate] installing seed deps (vitest)…"
  pnpm install --silent >/dev/null 2>&1 || pnpm install >/dev/null
fi

PATCH_FILE="$PATCH"
[ "$PATCH" = "solution" ] && PATCH_FILE="$TASK_DIR/solution/solution.patch"
if [ -s "$PATCH_FILE" ] && ! grep -q "^# Replace" "$PATCH_FILE"; then
  echo "[validate] applying patch: $PATCH_FILE"
  git apply --whitespace=nowarn "$PATCH_FILE"
else
  echo "[validate] no usable patch ($PATCH_FILE) — grading the bare seed"
fi

# Install the shared grader as `slopbench-grade` on PATH.
ln -s "$BENCH_ROOT/tasks/_base/run-verifier.sh" "$BIN/slopbench-grade"
chmod +x "$BENCH_ROOT/tasks/_base/run-verifier.sh"

PATH="$BIN:$PATH" APP_DIR="$APP" TESTS_DIR="$TASK_DIR/tests" LOG_DIR="$LOGS" \
  SLOP_VERIFY="$SV_BIN" REACT_DOCTOR_BIN="$RD_BIN" \
  bash "$TASK_DIR/tests/test.sh"

REWARD="$(cat "$LOGS/verifier/reward.txt")"
SCORE="$(python3 -c "import json;print(round(json.load(open('$LOGS/verifier/slop-report.json'))['slopScore'],2))")"
echo "[validate] reward=$REWARD slopScore=$SCORE expect=$EXPECT"
python3 -c "import json;r=json.load(open('$LOGS/verifier/slop-report.json'));print('[validate] violations:', sorted(set(v['ruleId'] for v in r['violations'])))"

PASS_NUM="$(python3 -c "print(1 if float('$REWARD')>0 else 0)")"
if [ "$EXPECT" = "pass" ] && [ "$PASS_NUM" != "1" ]; then echo "[validate] FAIL: expected reward>0"; exit 1; fi
if [ "$EXPECT" = "fail" ] && [ "$PASS_NUM" != "0" ]; then echo "[validate] FAIL: expected reward==0"; exit 1; fi
echo "[validate] OK"
