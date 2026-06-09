#!/usr/bin/env bash
# Reference solution applier (reviewer aid only — never used at grade time).
set -euo pipefail
cd /app
git apply --whitespace=nowarn /solution/solution.patch
