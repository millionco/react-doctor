#!/usr/bin/env bash

set -euo pipefail

TERMINAL_E2E_REPOSITORY_ROOT="$PWD"
TERMINAL_E2E_ARTIFACT_DIRECTORY="${TERMINAL_E2E_ARTIFACT_DIRECTORY:-$TERMINAL_E2E_REPOSITORY_ROOT/artifacts}"
TERMINAL_E2E_SESSION_NAME="react-doctor-terminal-e2e"
TERMINAL_E2E_RECORDING_PATH="$TERMINAL_E2E_ARTIFACT_DIRECTORY/react-doctor-terminal.termctrl"
TERMINAL_E2E_VIDEO_PATH="$TERMINAL_E2E_ARTIFACT_DIRECTORY/react-doctor-terminal.mp4"
TERMINAL_E2E_SCREENSHOT_PATH="$TERMINAL_E2E_ARTIFACT_DIRECTORY/react-doctor-terminal.png"
TERMINAL_E2E_COLUMNS=112
TERMINAL_E2E_ROWS=30
TERMINAL_E2E_LONG_WAIT_MS=60000
TERMINAL_E2E_SCAN_FEEDBACK_WAIT_MS=1500
TERMINAL_E2E_TYPING_PACE_MS=15
TERMINAL_E2E_VIDEO_FPS=30

mkdir -p "$TERMINAL_E2E_ARTIFACT_DIRECTORY"

stop_terminal_e2e_session() {
  termctrl stop "$TERMINAL_E2E_SESSION_NAME" >/dev/null 2>&1 || true
}

trap stop_terminal_e2e_session EXIT

termctrl start "$TERMINAL_E2E_SESSION_NAME" \
  --record "$TERMINAL_E2E_RECORDING_PATH" \
  --cols "$TERMINAL_E2E_COLUMNS" \
  --rows "$TERMINAL_E2E_ROWS" \
  --cwd "$TERMINAL_E2E_REPOSITORY_ROOT" \
  --color always \
  -- bash --noprofile --norc -i

termctrl send "$TERMINAL_E2E_SESSION_NAME" \
  text:"export PS1='terminal-e2e$ '" enter \
  text:"source scripts/setup-terminal-recording.sh" enter
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "terminal-recording-ready" \
  --timeout "$TERMINAL_E2E_LONG_WAIT_MS"
termctrl send "$TERMINAL_E2E_SESSION_NAME" text:clear enter
termctrl mark "$TERMINAL_E2E_SESSION_NAME" project-command

termctrl send "$TERMINAL_E2E_SESSION_NAME" --pace-ms "$TERMINAL_E2E_TYPING_PACE_MS" \
  text:run-terminal-recording-clean-scan enter
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "Select projects" \
  --timeout "$TERMINAL_E2E_LONG_WAIT_MS"
termctrl mark "$TERMINAL_E2E_SESSION_NAME" project-selection
termctrl send "$TERMINAL_E2E_SESSION_NAME" "text: "
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "1/2"
termctrl send "$TERMINAL_E2E_SESSION_NAME" enter
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "Scanning" \
  --timeout "$TERMINAL_E2E_SCAN_FEEDBACK_WAIT_MS"
termctrl mark "$TERMINAL_E2E_SESSION_NAME" scan-started
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "No issues found" \
  --timeout "$TERMINAL_E2E_LONG_WAIT_MS"
termctrl mark "$TERMINAL_E2E_SESSION_NAME" clean-report
termctrl show "$TERMINAL_E2E_SESSION_NAME"
termctrl send "$TERMINAL_E2E_SESSION_NAME" text:q
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "terminal-e2e-first-run-finished"

termctrl send "$TERMINAL_E2E_SESSION_NAME" text:use-terminal-recording-tui-fixture enter
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "terminal-e2e-tui-fixture-ready"
termctrl mark "$TERMINAL_E2E_SESSION_NAME" report-command
termctrl send "$TERMINAL_E2E_SESSION_NAME" --pace-ms "$TERMINAL_E2E_TYPING_PACE_MS" \
  text:run-terminal-recording-tui-scan enter
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "Add to GitHub Actions" \
  --timeout "$TERMINAL_E2E_LONG_WAIT_MS"
termctrl mark "$TERMINAL_E2E_SESSION_NAME" action-menu
termctrl send "$TERMINAL_E2E_SESSION_NAME" enter
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "enter copy context"
termctrl mark "$TERMINAL_E2E_SESSION_NAME" copy-context
termctrl send "$TERMINAL_E2E_SESSION_NAME" escape
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "Add to GitHub Actions"
termctrl mark "$TERMINAL_E2E_SESSION_NAME" action-menu-returned
termctrl send "$TERMINAL_E2E_SESSION_NAME" enter
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "Add React Doctor to GitHub Actions?"
termctrl mark "$TERMINAL_E2E_SESSION_NAME" action-confirmation
termctrl show "$TERMINAL_E2E_SESSION_NAME"
termctrl send "$TERMINAL_E2E_SESSION_NAME" escape
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "Add to GitHub Actions"
termctrl mark "$TERMINAL_E2E_SESSION_NAME" action-confirmation-cancelled

termctrl save "$TERMINAL_E2E_SESSION_NAME" \
  --format png \
  --out "$TERMINAL_E2E_SCREENSHOT_PATH" \
  --hide-cursor
termctrl send "$TERMINAL_E2E_SESSION_NAME" text:q
termctrl wait "$TERMINAL_E2E_SESSION_NAME" "terminal-e2e-second-run-finished"
termctrl mark "$TERMINAL_E2E_SESSION_NAME" finished
termctrl stop "$TERMINAL_E2E_SESSION_NAME"

termctrl markers "$TERMINAL_E2E_RECORDING_PATH"
termctrl video "$TERMINAL_E2E_RECORDING_PATH" \
  --edit "$TERMINAL_E2E_REPOSITORY_ROOT/scripts/terminal-e2e-video.json" \
  --footer \
  --fps "$TERMINAL_E2E_VIDEO_FPS" \
  --tail-ms 0 \
  --hide-cursor \
  --out "$TERMINAL_E2E_VIDEO_PATH"
