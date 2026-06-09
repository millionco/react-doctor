#!/usr/bin/env bash
#
# SlopBench shared grader (installed as `slopbench-grade` in the base image).
#
# A task's tests/test.sh is a thin wrapper that exports BASE_COMMIT +
# FUNCTIONAL_TEST_CMD and then `exec slopbench-grade`. This script:
#   0. Captures the agent's diff as model.patch (reviewer artifact).
#   1. Resets the files the hidden test.patch touches, then applies it.
#   2. Runs the task's functional tests (the correctness GATE).
#   3. Runs slop-verify offline to score React/TypeScript slop in the diff.
#   4. Writes the composite reward (functional_pass × slopScore/100) to
#      reward.txt and saves the full slop-report.json artifact.
#
# Every path is overridable by env var so the same script runs unchanged in the
# Harbor sandbox (the defaults) and locally for development.
set -uo pipefail

APP_DIR="${APP_DIR:-/app}"
TESTS_DIR="${TESTS_DIR:-/tests}"
LOG_DIR="${LOG_DIR:-/logs}"
ARTIFACT_DIR="${ARTIFACT_DIR:-${LOG_DIR}/artifacts}"
VERIFIER_DIR="${VERIFIER_DIR:-${LOG_DIR}/verifier}"
SLOP_VERIFY="${SLOP_VERIFY:-slop-verify}"
REACT_DOCTOR_BIN="${REACT_DOCTOR_BIN:-react-doctor}"
SLOP_PROFILE="${SLOP_PROFILE:-}"
# Optional hard floor: fail the task (reward 0) if slopScore drops below this,
# even when the functional tests pass. Default 0 = no floor.
SLOP_MIN_SCORE="${SLOP_MIN_SCORE:-0}"

log() { echo "[slopbench] $*"; }
fail() { log "ERROR: $*"; exit "${2:-1}"; }

[ -n "${BASE_COMMIT:-}" ] || fail "BASE_COMMIT is not set (task test.sh must export it)" 2
command -v "$SLOP_VERIFY" >/dev/null 2>&1 || [ -x "$SLOP_VERIFY" ] || fail "slop-verify not found: $SLOP_VERIFY" 3

mkdir -p "$ARTIFACT_DIR" "$VERIFIER_DIR" || fail "cannot create log dirs" 4
cd "$APP_DIR" || fail "app dir missing: $APP_DIR" 5
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

git rev-parse --verify "${BASE_COMMIT}^{commit}" >/dev/null 2>&1 \
  || fail "base commit $BASE_COMMIT not present in repo" 6

# --- Step 0: capture the agent's diff as model.patch (reviewer artifact) ---
log "Step 0: capturing model.patch"
git reset -q --soft "$BASE_COMMIT" && git add -A -- . \
  && git diff --cached --binary > "${ARTIFACT_DIR}/model.patch" \
  && git reset -q \
  || log "warning: could not capture model.patch (continuing)"

# --- Step 1: score slop on the agent's tree BEFORE hidden tests touch it ---
# The hidden tests only add test files (filtered out of grading), so scoring
# here vs. after is equivalent — doing it first keeps the scored tree purely the
# agent's product code.
log "Step 1: scoring slop"
slop_args=(--root "$APP_DIR" --base "$BASE_COMMIT" --doctor-bin "$REACT_DOCTOR_BIN" \
  --out "${VERIFIER_DIR}/slop-report.json" --quiet)
[ -n "$SLOP_PROFILE" ] && slop_args+=(--profile "$SLOP_PROFILE")
"$SLOP_VERIFY" "${slop_args[@]}" || log "warning: slop-verify exited non-zero"
[ -f "${VERIFIER_DIR}/slop-report.json" ] || fail "slop-report.json was not produced" 7

# --- Step 2: apply the hidden test patch (if any) ---
if [ -f "${TESTS_DIR}/test.patch" ] && [ -s "${TESTS_DIR}/test.patch" ]; then
  log "Step 2: applying hidden test.patch"
  python3 - "$APP_DIR" "${TESTS_DIR}/test.patch" <<'PY' | while IFS= read -r f; do
import re, sys
patch = open(sys.argv[2], encoding="utf-8").read()
files = set()
for line in patch.splitlines():
    m = re.match(r'^diff --git "?a/.+ "?b/(.+?)"?$', line)
    if m:
        files.add(m.group(1))
for f in sorted(files):
    print(f)
PY
    git checkout HEAD -- "$f" 2>/dev/null || rm -rf "$f" 2>/dev/null || true
  done
  git apply --whitespace=nowarn "${TESTS_DIR}/test.patch" || fail "failed to apply test.patch" 8
else
  log "Step 2: no test.patch (skipping)"
fi

# --- Step 3: functional correctness gate ---
log "Step 3: running functional tests"
FUNCTIONAL_PASS=0
if [ -n "${FUNCTIONAL_TEST_CMD:-}" ]; then
  if bash -c "$FUNCTIONAL_TEST_CMD"; then
    FUNCTIONAL_PASS=1
    log "functional tests PASSED"
  else
    log "functional tests FAILED"
  fi
else
  log "warning: no FUNCTIONAL_TEST_CMD set — treating functional gate as failed"
fi

# --- Step 4: combine into the composite reward + finalize the report ---
log "Step 4: computing reward"
REWARD=$(FUNCTIONAL_PASS="$FUNCTIONAL_PASS" SLOP_MIN_SCORE="$SLOP_MIN_SCORE" \
  python3 - "${VERIFIER_DIR}/slop-report.json" <<'PY'
import json, os, sys
path = sys.argv[1]
report = json.load(open(path))
passed = os.environ.get("FUNCTIONAL_PASS") == "1"
floor = float(os.environ.get("SLOP_MIN_SCORE", "0"))
score = float(report.get("slopScore", 0.0))
gated = passed and score >= floor
reward = (score / 100.0) if gated else 0.0
report["functionalPass"] = passed
report["reward"] = reward
json.dump(report, open(path, "w"), indent=2)
print(f"{reward:.6f}")
PY
)
echo "$REWARD" > "${VERIFIER_DIR}/reward.txt" || fail "could not write reward.txt" 9

SCORE=$(python3 -c "import json;print(json.load(open('${VERIFIER_DIR}/slop-report.json'))['slopScore'])")
log "RESULT functional_pass=${FUNCTIONAL_PASS} slop_score=${SCORE} reward=${REWARD}"
exit 0
