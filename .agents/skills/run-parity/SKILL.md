---
name: run-parity
description: Run full-corpus React Doctor parity for a GitHub pull request with the Daytona evaluator, then compare baseline and PR-head diagnostics. Use when the user asks to run parity, check a PR for diagnostic regressions, compare a PR against its base, or produce added and removed diagnostic counts for a PR.
---

# Run PR Parity

Compare the PR's exact `baseRefOid` and `headRefOid` across the same pinned OSS corpus. Build each React Doctor ref once, fan repository scans out through Daytona, and compare the resulting NDJSON deterministically.

## Preconditions

- Work from the React Doctor repository root.
- Require `DAYTONA_API_KEY`.
- Require an authenticated `gh` CLI and the sibling `react-doctor-evals` checkout.
- Use the PR head commit already on GitHub. Never push a local commit just to make parity runnable without user permission.
- Use `ni` for installation and `nr` for package scripts.

## Resolve the PR

Use the PR supplied by the user, or the PR for the current branch when none is supplied:

```sh
gh pr view <pr-number-or-url> \
  --json number,url,baseRefOid,headRefOid,headRepository,headRepositoryOwner
```

Read the baseline `owner/repository` from the PR URL. Construct the baseline repository as `https://github.com/<base-owner>/<base-repository>.git`. Construct the candidate repository as `https://github.com/<headRepositoryOwner.login>/<headRepository.name>.git`.

Do not substitute branch names for the returned commit SHAs. The two runs must stay reproducible if either branch moves.

## Prepare the corpus and output directory

Create an ignored directory under `tmp/parity-pr-<number>-<head-short-sha>`. Preserve it after the run.

Fetch the latest eval corpus without changing the sibling checkout's branch or working tree:

```sh
git -C ../react-doctor-evals fetch origin main
git -C ../react-doctor-evals show origin/main:repos.json > <run-directory>/repositories.json
ni
```

Use the same `repositories.json` and concurrency for both runs. Default to concurrency 500 unless the user requests another value.

## Run both sides

Run from `packages/evals`, redirecting only stdout. Progress and completion metrics remain visible on stderr.

```sh
nr eval -- \
  --repositories <absolute-run-directory>/repositories.json \
  --concurrency 500 \
  --react-doctor-repository <baseline-repository-url> \
  --react-doctor-ref <baseRefOid> \
  > <absolute-run-directory>/baseline.ndjson

nr eval -- \
  --repositories <absolute-run-directory>/repositories.json \
  --concurrency 500 \
  --react-doctor-repository <candidate-repository-url> \
  --react-doctor-ref <headRefOid> \
  > <absolute-run-directory>/candidate.ndjson
```

Do not compare partial runs. Confirm both commands report 100% completion before proceeding.

## Compare

Return to the repository root and run:

```sh
node .agents/skills/run-parity/scripts/compare-parity.mjs \
  <run-directory>/baseline.ndjson \
  <run-directory>/candidate.ndjson \
  > <run-directory>/parity.json
```

Interpret exit codes:

- `0`: diagnostic parity.
- `1`: valid comparison with added or removed diagnostics. Continue and report the diff.
- `2`: incomplete or invalid input. Do not claim parity; inspect failed or missing projects.

## Report

Report:

- PR URL and exact base/head SHAs.
- Corpus project count and skipped-project count.
- Baseline and candidate diagnostic totals.
- Added, removed, and unchanged counts.
- Rules with the largest added and removed counts.
- Clickable paths to `baseline.ndjson`, `candidate.ndjson`, and `parity.json`.

Treat added or removed diagnostics as evidence to inspect, not automatically as a regression or improvement. Sample the affected source locations before classifying the change.
