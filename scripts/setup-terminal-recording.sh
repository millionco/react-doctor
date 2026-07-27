#!/usr/bin/env bash

set -euo pipefail

TERMINAL_RECORDING_REPOSITORY_ROOT="$PWD"
TERMINAL_RECORDING_DIRECTORY="$(mktemp -d)"
TERMINAL_RECORDING_TUI_DIRECTORY="$(mktemp -d)"
TERMINAL_RECORDING_GIT_DIRECTORY="$TERMINAL_RECORDING_DIRECTORY/.terminal-recording-bin"
TERMINAL_RECORDING_FIXTURE_SLUG="shadcn-ui/ui"
trap 'rm -rf "$TERMINAL_RECORDING_DIRECTORY" "$TERMINAL_RECORDING_TUI_DIRECTORY"' EXIT

mapfile -t TERMINAL_RECORDING_FIXTURE < <(
  node -e '
    const fs = require("node:fs");
    const corpus = JSON.parse(fs.readFileSync("scripts/delta-audit/corpus.json", "utf8"));
    const fixture = corpus.find((candidate) => candidate.slug === process.argv[1]);
    if (!fixture) process.exit(1);
    console.log(fixture.url);
    console.log(fixture.sha);
  ' "$TERMINAL_RECORDING_FIXTURE_SLUG"
)

if [[ ${#TERMINAL_RECORDING_FIXTURE[@]} -ne 2 ]]; then
  echo "Could not resolve $TERMINAL_RECORDING_FIXTURE_SLUG from the delta-audit corpus." >&2
  return 1
fi

git -C "$TERMINAL_RECORDING_DIRECTORY" init --quiet
git -C "$TERMINAL_RECORDING_DIRECTORY" remote add origin "${TERMINAL_RECORDING_FIXTURE[0]}"
git -C "$TERMINAL_RECORDING_DIRECTORY" fetch --quiet --depth=1 --filter=blob:none \
  origin "${TERMINAL_RECORDING_FIXTURE[1]}"
git -C "$TERMINAL_RECORDING_DIRECTORY" checkout --quiet -b main FETCH_HEAD

python3 "$TERMINAL_RECORDING_REPOSITORY_ROOT/scripts/smoke-tty-prompt.py" \
  --prepare-git-wrapper "$TERMINAL_RECORDING_DIRECTORY"
python3 "$TERMINAL_RECORDING_REPOSITORY_ROOT/scripts/smoke-tty-prompt.py" \
  --prepare-fixture "$TERMINAL_RECORDING_TUI_DIRECTORY"

export PATH="$TERMINAL_RECORDING_GIT_DIRECTORY:$PATH"
unset CI GITHUB_ACTIONS GITLAB_CI BUILDKITE JENKINS_URL TF_BUILD CODEBUILD_BUILD_ID
unset TEAMCITY_VERSION BITBUCKET_BUILD_NUMBER CIRCLECI TRAVIS DRONE GIT_DIR
unset CLAUDECODE CLAUDE_CODE CURSOR_AGENT CODEX_CI CODEX_SANDBOX
unset CODEX_SANDBOX_NETWORK_DISABLED OPENCODE GOOSE_TERMINAL AGENT_SESSION_ID
unset AMP_THREAD_ID AGENT_THREAD_ID AGENT

react-doctor() {
  node "$TERMINAL_RECORDING_REPOSITORY_ROOT/packages/react-doctor/dist/cli.js" "$@"
}
export -f react-doctor

use-terminal-recording-tui-fixture() {
  cd "$TERMINAL_RECORDING_TUI_DIRECTORY"
}
export -f use-terminal-recording-tui-fixture

cd "$TERMINAL_RECORDING_DIRECTORY"
clear
printf 'terminal-recording-ready\n'

set +e +u
set +o pipefail
