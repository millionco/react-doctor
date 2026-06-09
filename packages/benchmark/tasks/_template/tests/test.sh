#!/usr/bin/env bash
# Thin wrapper — the shared `slopbench-grade` script (baked into the base image)
# does the model.patch capture, hidden-test apply, functional gate, slop scan,
# and reward.txt write. Just declare this task's specifics.
set -euo pipefail

# The commit the agent started from (matches task.toml base_commit_hash).
export BASE_COMMIT="TODO: base commit sha"

# Command that runs THIS task's functional tests (added by tests/test.patch).
# Must exit 0 iff the implemented behavior is correct.
export FUNCTIONAL_TEST_CMD="TODO: e.g. pnpm exec vitest run tests/feature.test.ts"

exec slopbench-grade
