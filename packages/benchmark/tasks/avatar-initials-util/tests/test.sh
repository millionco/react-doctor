#!/usr/bin/env bash
set -euo pipefail
export BASE_COMMIT="$(git -C "${APP_DIR:-/app}" rev-list --max-parents=0 HEAD | tail -1)"
export FUNCTIONAL_TEST_CMD="node --experimental-strip-types --test tests/avatar-initials.test.ts"
exec slopbench-grade
