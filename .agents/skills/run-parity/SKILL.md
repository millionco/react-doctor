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

Run from `packages/evals`. The default corpus contains the 2,000 highest-ranked repositories, and the initial concurrency is 200. Sandbox creation is capped at 20 to avoid overloading Daytona. The evaluator cleans up resources and retries failed projects at concurrency 50, then 10.

```sh
nr --silent eval \
  --react-doctor-repository <base-repository-url> \
  --react-doctor-ref <baseRefOid> \
  > <absolute-run-directory>/baseline.ndjson

nr --silent eval \
  --repositories <absolute-run-directory>/baseline.ndjson \
  --react-doctor-repository <head-repository-url> \
  --react-doctor-ref <headRefOid> \
  > <absolute-run-directory>/candidate.ndjson
```

The baseline records resolved repository hashes. Reusing the baseline as the candidate corpus prevents default branches from moving between runs.

Before the candidate run, stream-validate every baseline record. This rejects unpinned repositories, evaluation errors, malformed reports, and incomplete projects without loading the NDJSON corpus into memory:

```sh
jq -e -n \
  -f <repository-root>/.agents/skills/run-parity/scripts/validate-parity-input.jq \
  <absolute-run-directory>/baseline.ndjson >/dev/null
```

If the baseline command exits non-zero or the check fails, inspect its failed records and stop. Candidate runs reject unpinned evaluation NDJSON.

Require both commands to exit zero and report 100% completion. Otherwise, report the failed projects and stop the comparison.

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

The evaluator retries incomplete reports instead of recording them as successful. The comparator validates both inputs again and exits with invalid-input status if either side contains an evaluation error, a malformed report, a missing completion marker, or a partial legacy report. It canonicalizes diagnostics to report-relative identities across legacy and v3 report schemas, so overlapping workspace scans do not inflate counts and schema upgrades do not appear as diagnostic churn.

The comparator streams both NDJSON inputs, stages baseline records in the system temporary directory, and writes large detail arrays incrementally. It retains changed diagnostic entries only long enough to sort them deterministically, so leave temporary-disk and output capacity proportional to the run size.

For exit code `1`, inspect affected source locations before classifying changes.

Validate comparator changes from the repository root:

```sh
node --test .agents/skills/run-parity/scripts/compare-parity.test.mjs
node --test .agents/skills/run-parity/scripts/validate-parity-input.test.mjs
```

## Report results

Report the pull request URL, commit hashes, compared and skipped project counts, diagnostic totals, added and removed counts, largest rule deltas, and artifact paths.
