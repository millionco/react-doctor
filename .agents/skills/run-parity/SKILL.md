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

Cache a successful baseline only under its exact React Doctor commit, corpus
manifest hash, evaluator schema, and ruleset/config hash. A cached baseline must
still pass the streaming validator before reuse. PRs may share that immutable
baseline, but never combine their candidate heads or deltas.

The evaluator stamps every record with the exact detector commit, revision-local
rule/config hash, and evaluator source hash. Never cache an older unstamped run.
After the normal input validator passes, create the adjacent provenance file:

```sh
node .agents/skills/run-parity/scripts/baseline-cache-provenance.mjs create \
  --baseline <baseline.ndjson> \
  --corpus-manifest <corpus-manifest.json> \
  --base-commit <full-base-commit> \
  --repository <react-doctor-repository-url> \
  --evaluator-source-hash <packages-evals-source-hash> \
  --config-contract revision-local-rule-config-v1 \
  --rule-set-hash <stamped-full-ruleset-hash>
```

Get the expected evaluator hash with `nr --silent source-hash` from
`packages/evals`. Before every reuse, run the same command with `verify`.
Verification streams the raw NDJSON bytes, requires full-baseline `ruleKeys: []`,
checks every record's producer, and independently requires the exact pinned
corpus project set to match its manifest. Any mismatch is a cache miss.

For rule-only pull requests, build the conservative impact manifest before the
candidate run:

```sh
node .agents/skills/run-parity/scripts/find-impacted-rules.mjs \
  <repository-root> <base-ref> <head-ref> <impact.json>
```

Use incremental mode only when the manifest reports `"mode": "incremental"`.
Its `candidateRuleKeys` already includes known diagnostic-interaction closure.
Write those keys unchanged to the rules JSON and pass each as a repeatable
candidate argument:

```sh
nr --silent eval \
  --repositories <validated-baseline-or-corpus-manifest> \
  --react-doctor-repository <head-repository-url> \
  --react-doctor-ref <headRefOid> \
  --rule <plugin/rule> \
  > <absolute-run-directory>/candidate-scoped.ndjson
```

The evaluator stamps every unselected revision-local rule `off`. When the
scope contains no security-scan rule it also skips that whole-tree pass.
Security-scan rule changes, global runner/config/report/registry changes,
removed or renamed rule IDs, unresolved runtime edges, parse failures, and
other uncertain dependency surfaces fall back to full parity. Plugin utilities
that reach a host module without first crossing a mapped rule boundary also
fall back to full parity. A manifest with no runtime rule impact uses full mode;
never construct an empty incremental rule scope.

Every run keeps its hard outer timeout. Short evaluator budgets cap aggregate
retry reserve at 25% of the time remaining when an attempt starts, leaving at
least 75% for active work instead of letting snapshot build consume the whole
first-attempt deadline.

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

For a scoped comparison, filter the full baseline to the same rule and
always-on invariant scope:

```sh
node .agents/skills/run-parity/scripts/compare-parity.mjs \
  --rules <rules.json> \
  <baseline.ndjson> \
  <candidate-scoped.ndjson> \
  > <run-directory>/parity-scoped.json
```

The scoped comparator rejects arbitrary out-of-scope candidate diagnostics,
requires exact project/framework/analyzed-file coverage, preserves duplicate
multiplicity, and compares every semantic diagnostic field including canonical
primary and related paths.

Build compact Merkle indexes when the same baseline or candidate will be
compared more than once:

```sh
node .agents/skills/run-parity/scripts/build-parity-index.mjs \
  --rules <rules.json> <baseline.ndjson> \
  > <baseline.index.json>

node .agents/skills/run-parity/scripts/build-parity-index.mjs \
  --candidate --rules <rules.json> <candidate-scoped.ndjson> \
  > <candidate.index.json>

node .agents/skills/run-parity/scripts/compare-parity-indexes.mjs \
  <baseline.index.json> <candidate.index.json> \
  > <index-diff.json>
```

Equal whole-run roots stop immediately. Differing roots descend through rule
hashes and then project buckets. Empty project/rule buckets are explicit, and
scope or coverage metadata drift fails closed.

Until incremental parity has enough shadow history to become a required gate,
run one full candidate at the exact same head/corpus/concurrency policy and
require its rule-filtered output to match the scoped candidate exactly. Report
measured wall time and project latency; do not project a speedup from samples.

Validate comparator changes from the repository root:

```sh
node --test .agents/skills/run-parity/scripts/compare-parity.test.mjs
node --test .agents/skills/run-parity/scripts/find-impacted-rules.test.mjs
node --test .agents/skills/run-parity/scripts/parity-index.test.mjs
node --test .agents/skills/run-parity/scripts/validate-parity-input.test.mjs
```

## Report results

Report the pull request URL, commit hashes, compared and skipped project counts, diagnostic totals, added and removed counts, largest rule deltas, and artifact paths.
