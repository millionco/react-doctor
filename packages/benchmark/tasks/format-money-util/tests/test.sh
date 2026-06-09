#!/usr/bin/env bash
set -euo pipefail

# In-tree seed: the base commit is the repo's root commit (created when the
# image seeds the project), resolved at runtime so no fixed sha is needed.
export BASE_COMMIT="$(git -C "${APP_DIR:-/app}" rev-list --max-parents=0 HEAD | tail -1)"

# Pure-TS task: run with Node's built-in test runner + type stripping (offline,
# no dependency install).
export FUNCTIONAL_TEST_CMD="node --experimental-strip-types --test tests/format-money.test.ts"

exec slopbench-grade
