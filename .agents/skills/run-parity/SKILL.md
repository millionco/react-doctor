---
name: run-parity
description: Compare React Doctor diagnostics for a GitHub pull request (PR) with Daytona. Use when asked to run parity, check a PR for diagnostic regressions, compare a PR with its base, or report added and removed diagnostics.
---

# Run pull request parity

Run the pull request base and head against the same repository commits. Write deterministic newline-delimited JSON (NDJSON) artifacts and compare them.

## Prepare the run

Require `DAYTONA_API_KEY`, authenticated `gh`, and a pushed pull request head. Do not push changes without permission. Use `ni` and `nr` in this repository.

Resolve the pull request:

```sh
gh pr view <pr-number-or-url> \
  --json number,url,baseRefOid,headRefOid,headRepository,headRepositoryOwner
```

Derive the base repository from the pull request URL. Derive the head repository from `headRepositoryOwner.login` and `headRepository.name`. Use the returned commit hashes, not branch names.

Create `tmp/parity-pr-<number>-<head-short-sha>` and preserve it after the run. Run `ni` before evaluation.

## Run both revisions

Run from `packages/evals`. The default corpus contains 2,000 selected repositories, and the default concurrency is 500.

```sh
nr eval \
  --react-doctor-repository <base-repository-url> \
  --react-doctor-ref <baseRefOid> \
  > <absolute-run-directory>/baseline.ndjson

nr eval \
  --repositories <absolute-run-directory>/baseline.ndjson \
  --react-doctor-repository <head-repository-url> \
  --react-doctor-ref <headRefOid> \
  > <absolute-run-directory>/candidate.ndjson
```

The baseline records resolved repository hashes. Reusing the baseline as the candidate corpus prevents default branches from moving between runs.

Require both runs to report 100% completion. Otherwise, report the failed projects and stop the comparison.

## Compare results

Run from the repository root:

```sh
node .agents/skills/run-parity/scripts/compare-parity.mjs \
  <run-directory>/baseline.ndjson \
  <run-directory>/candidate.ndjson \
  > <run-directory>/parity.json
```

Interpret exit codes:

- `0`: diagnostics match
- `1`: comparison succeeded with diagnostic changes
- `2`: inputs are incomplete or invalid

For exit code `1`, inspect affected source locations before classifying changes.

## Report results

Report the pull request URL, commit hashes, compared and skipped project counts, diagnostic totals, added and removed counts, largest rule deltas, and artifact paths.
