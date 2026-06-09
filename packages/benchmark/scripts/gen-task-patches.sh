#!/usr/bin/env bash
#
# Generate a task's solution.patch and test.patch from authoring inputs:
#   tasks/<id>/seed/              the starting repo
#   tasks/<id>/_authoring/solved/ files overwriting seed paths = the reference fix
#   tasks/<id>/_authoring/hidden/ files ADDED (e.g. tests/*.test.ts) = hidden tests
#
# Produces solution/solution.patch (seed -> solved) and tests/test.patch (added
# hidden files), as real git patches. The _authoring/ inputs stay in-tree as the
# human-readable source for the (otherwise opaque) patches.
#
# Usage: scripts/gen-task-patches.sh <task-dir>
set -euo pipefail

TASK_DIR="$(cd "$1" && pwd)"
SOLVED="$TASK_DIR/_authoring/solved"
HIDDEN="$TASK_DIR/_authoring/hidden"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp -a "$TASK_DIR/seed/." "$WORK/"
cd "$WORK"
git init -q && git config user.email t@t.co && git config user.name t
git add -A && git commit -qm base >/dev/null

# solution.patch: overlay the solved files, diff against the seed.
if [ -d "$SOLVED" ]; then
  cp -a "$SOLVED/." "$WORK/"
  git diff > "$TASK_DIR/solution/solution.patch"
  git checkout -- . >/dev/null 2>&1
  echo "wrote solution.patch ($(grep -c '^diff' "$TASK_DIR/solution/solution.patch") file(s))"
fi

# test.patch: add the hidden files (intent-to-add), diff just those.
if [ -d "$HIDDEN" ]; then
  cp -a "$HIDDEN/." "$WORK/"
  ( cd "$HIDDEN" && find . -type f -printf '%P\n' ) | while IFS= read -r rel; do
    git add -N -- "$rel"
  done
  ( cd "$HIDDEN" && find . -type f -printf '%P\n' ) | sed "s#^#$WORK/#" >/dev/null
  HIDDEN_PATHS=$(cd "$HIDDEN" && find . -type f -printf '%P\n')
  # shellcheck disable=SC2086
  git -c core.quotepath=false diff -- $HIDDEN_PATHS > "$TASK_DIR/tests/test.patch"
  echo "wrote test.patch ($(grep -c '^diff' "$TASK_DIR/tests/test.patch") file(s))"
fi
