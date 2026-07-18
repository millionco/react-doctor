---
name: rde-eval
description: Run a targeted local react-doctor-evals (RDE) loop against an uncommitted React Doctor rule change, inspect target-rule hits, and hand a finished PR to Daytona full-corpus parity. Use after focused rule tests pass, while iterating on false positives in real OSS code, or whenever rule-validate calls for local RDE evidence before run-parity.
---

# RDE Eval

Use RDE locally for fast rule iteration. Use `run-parity` for the final full-corpus PR comparison.

| Need                                   | Workflow     |
| -------------------------------------- | ------------ |
| Uncommitted rule change, quick sample  | `rde-eval`   |
| Filter and inspect one rule's OSS hits | `rde-eval`   |
| Exact PR base versus head, full corpus | `run-parity` |

Do not use the old Vercel cloud path for oxlint rule validation. It can omit the AST rule layer and return a misleading zero. Daytona parity builds the full React Doctor checkout and is the canonical scaled run.

## Local Setup

Set checkout paths without changing either working tree:

```sh
export REACT_DOCTOR_CHECKOUT=/absolute/path/to/react-doctor
export RDE_CHECKOUT=/absolute/path/to/react-doctor-evals

git -C "$RDE_CHECKOUT" pull --ff-only
ni -C "$RDE_CHECKOUT"
nr -C "$RDE_CHECKOUT" build
nr -C "$REACT_DOCTOR_CHECKOUT" build
```

Run all RDE CLI commands from the eval checkout. The `path:` spec reads the React Doctor working tree, including uncommitted edits.

## Targeted Local Loop

Start with a capped sample. Increase it only after tests and the first sample are clean.

```sh
cd "$RDE_CHECKOUT"
node dist/cli.js run "path:$REACT_DOCTOR_CHECKOUT" --runner local --take 100
node dist/cli.js digest "path:$REACT_DOCTOR_CHECKOUT" --rule <rule-id>
node dist/cli.js digest "path:$REACT_DOCTOR_CHECKOUT" --json --rule <rule-id> > <artifact-path>/hits.json
```

The full manifest contains thousands of project roots. Keep `--take` bounded while iterating.

## Inspect Results

For every hit when counts are low, or a representative sample when counts are high:

1. Open the pinned repository and exact `filePath:line:column`.
2. Decide whether the code satisfies the rule contract.
3. Classify it as a true positive, false positive, or unsupported case.
4. Add a focused rule regression test for every false positive.
5. Add confirmed false positives to the `fuzz` regression corpus.
6. Rebuild React Doctor and rerun the same RDE sample until clean.

Record distinct repositories separately from root-directory scans.

## Full PR Parity Handoff

After the rule is committed, pushed, and attached to a PR, invoke:

```text
Use $run-parity for PR <number-or-url>.
```

`run-parity` requires `DAYTONA_API_KEY`, authenticated `gh`, and the sibling RDE checkout. It resolves the PR's immutable base/head SHAs, snapshots the corpus, defaults to concurrency 500, and writes:

- `baseline.ndjson`
- `candidate.ndjson`
- `parity.json`

Do not claim full parity from a capped local RDE run.

## Report to Rule Validate

```md
Local RDE:

- React Doctor checkout: <path and ref>
- RDE checkout: <path and ref>
- Target rule: <rule-id>
- Distinct repositories: <count>
- RootDir scans: <count>
- Target diagnostics: <count>
- Manually inspected: <count>
- False positives found and fixed: <count and tests>
- Hits artifact: <path>

Full PR parity:

- PR and exact base/head SHAs: <values or not run>
- Compared/skipped projects: <counts>
- Added/removed diagnostics: <counts>
- Target rule delta: <counts>
- Artifacts: <paths>
```

## Troubleshooting

- Stale local results: use a commit SHA or a new checkout path as the spec cache key, then rerun.
- Mostly error records: inspect the cached JSONL before trusting a digest and fix the first common setup failure.
- Oxlint out of memory on one repository: record the skipped repository; do not reinterpret it as zero diagnostics.
- Missing Daytona credentials: finish local RDE, record the blocker, and do not claim full PR parity.
