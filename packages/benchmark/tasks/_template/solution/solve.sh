#!/usr/bin/env bash
# Reference solution applier (reviewer aid only — NEVER used at grade time).
# Applies a clean, high-scoring implementation so reviewers can confirm the task
# is solvable and that a good solution scores well on both axes.
set -euo pipefail
cd /app
git apply --whitespace=nowarn /solution/solution.patch
