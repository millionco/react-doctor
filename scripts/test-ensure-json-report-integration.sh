#!/usr/bin/env bash
# Integration test for ensure-json-report.mjs fix
# Simulates the npm exec stdout pollution scenario

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_DIR="$(mktemp -d)"
REPORT_FILE="$TEMP_DIR/report.json"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "Testing ensure-json-report.mjs with npm exec pollution..."

# Valid JSON report
VALID_REPORT='{
  "schemaVersion": 3,
  "version": "0.9.12",
  "ok": true,
  "directory": "/test",
  "mode": "full",
  "diff": null,
  "projects": [],
  "diagnostics": [],
  "summary": {
    "errorCount": 0,
    "warningCount": 0,
    "affectedFileCount": 0,
    "totalDiagnosticCount": 0,
    "score": 100,
    "scoreLabel": "excellent"
  },
  "elapsedMilliseconds": 1234
}'

# Test 1: Corrupted with npm warning
echo "Test 1: Report corrupted with npm warning prefix..."
echo "npm warn exec The following package was not found and will be installed: react-doctor@0.9.12" > "$REPORT_FILE"
echo "$VALID_REPORT" >> "$REPORT_FILE"

if node "$SCRIPT_DIR/ensure-json-report.mjs" "$REPORT_FILE" 0; then
  echo "✓ Test 1 passed: Script accepted corrupted report and stripped npm warning"
else
  echo "✗ Test 1 failed: Script rejected valid report with npm warning prefix"
  exit 1
fi

# Verify the report wasn't overwritten with fallback
if grep -q '"ok": true' "$REPORT_FILE"; then
  echo "✓ Original report preserved"
else
  echo "✗ Report was incorrectly overwritten"
  exit 1
fi

# Test 2: Clean report (no corruption)
echo ""
echo "Test 2: Clean report (control)..."
echo "$VALID_REPORT" > "$REPORT_FILE"

if node "$SCRIPT_DIR/ensure-json-report.mjs" "$REPORT_FILE" 0; then
  echo "✓ Test 2 passed: Script accepted clean report"
else
  echo "✗ Test 2 failed: Script rejected valid clean report"
  exit 1
fi

# Test 3: Completely invalid content
echo ""
echo "Test 3: Invalid content (should write fallback)..."
echo "completely invalid content with no JSON" > "$REPORT_FILE"

if ! node "$SCRIPT_DIR/ensure-json-report.mjs" "$REPORT_FILE" 1; then
  echo "✓ Test 3 passed: Script wrote fallback for invalid content"
else
  echo "✗ Test 3 failed: Script incorrectly accepted invalid content"
  exit 1
fi

# Verify fallback was written
if grep -q '"ok":false' "$REPORT_FILE" && grep -q '"schemaVersion":3' "$REPORT_FILE"; then
  echo "✓ Fallback report written correctly"
else
  echo "✗ Fallback report incorrect"
  cat "$REPORT_FILE"
  exit 1
fi

echo ""
echo "All integration tests passed! ✓"
