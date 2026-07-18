---
name: rule-validate
description: Validate implemented React Doctor rules before PR or merge. Use after rule tests pass to review correctness, run targeted local RDE and full-corpus PR parity, inspect false positives, generate changesets, write PR descriptions, and triage bot or human review comments.
---

# Rule Validate

Use this as stage 3 of the React Doctor rule pipeline.

Pipeline:

1. `rule-research` defines the rule contract.
2. `rule-writing` turns the contract into tests and implementation.
3. `rule-validate` verifies noise, correctness, changesets, PR copy, and review feedback.
4. `run-parity` compares the finished PR against its base across the full corpus.

Validation is not just running tests. It checks whether the rule still matches the contract on real code.

## Interactive Coaching

Before broad or expensive validation, tell the user what will run and what evidence it will produce.

Pause for the user only when:

- RDE or OSS validation is expensive or needs paths/manifests.
- A review comment is ambiguous and could broaden v1 scope.
- A false-positive fix would change the rule contract.
- A check fails for unrelated repo state and the next step is not obvious.

Otherwise, fix real findings and add regression tests.

## Local Validation

Run the tightest useful checks first:

- Focused rule tests.
- Typecheck for the touched package.
- Lint or format checks required by the repo.
- Full test/lint/typecheck only when risk or user request justifies it.

Record every command as passed, failed, or not run. If a broad command fails because of unrelated repo state, record the failure location and the focused command that passed.

## Implementation Review

Review the diff like a rule reviewer. Lead with bugs:

- False positives.
- False negatives for claimed behavior.
- Scope or binding mistakes.
- Control-flow path merges that create impossible behavior.
- Nested functions analyzed as immediate execution.
- Dynamic computed properties treated as static names.
- Transparent wrappers missed.
- Imported or unknown code reported without support.
- Diagnostic wording that overclaims.
- Missing valid or invalid regression tests.

Before approving a new helper or utility in the diff, confirm it does not duplicate an existing symbol with `truffler` (the `find-similar-functions` skill): `bunx @rayhanadev/truffler "<helper name>" packages --kind function,method,interface,type,constant --limit 20`.

Fix every real implementation bug with a targeted regression test.

## OSS Validation

Use two tiers:

1. Use `rde-eval` for a fast, targeted local loop against the uncommitted working tree. Filter to the target rule and use a capped repository sample while iterating.
2. Use `run-parity` for the final full-corpus PR comparison. It resolves immutable base/head SHAs, runs both through Daytona using the same corpus snapshot, and writes baseline, candidate, and parity artifacts.

Run full PR parity for every new rule and every detector behavior change unless the change is test-only or documentation-only. If it cannot run, record the exact blocker instead of implying parity.

Invoke it after the PR head is pushed:

```text
Use $run-parity for PR <number-or-url>.
```

The run requires `DAYTONA_API_KEY`, authenticated `gh`, and the sibling `react-doctor-evals` checkout. Default concurrency is 500. Follow the `run-parity` skill for the exact commands and exit-code handling.

Required handling:

- Scan distinct repos, not just manifest entries.
- Record rootDir scan count separately from repo count.
- Filter output to the target rule before judging results.
- Inspect every hit manually when counts are low.
- Sample hits manually when counts are high.
- Add regression tests for false positives found by evals.

Record:

```md
PR and exact base/head SHAs:
Corpus snapshot:
Baseline projects and diagnostics:
Candidate projects and diagnostics:
Skipped projects:
Added and removed diagnostics:
Target rule delta:
Manually inspected hits:
False positives found and fixed:
Artifacts:
```

## PR Description

Write PR copy after validation, not before. Use this structure:

````md
## Why

Catches <specific issue>.

<Runtime reason in 1-3 sentences.>

Before:

```tsx
<bad example>
```

After:

```tsx
<good example>
```

## What changed

- Added `<rule-name>`.
- Detects <main detection surface>.
- Reports <exact condition>.
- Allows <important valid patterns>.
- Adds tests for <edge cases>.

## Eval results

| Check                 | Result                                      |
| --------------------- | ------------------------------------------- |
| Projects compared     | `<count>`                                   |
| Skipped projects      | `<count>`                                   |
| Baseline diagnostics  | `<count>`                                   |
| Candidate diagnostics | `<count>`                                   |
| Added / removed       | `<added> / <removed>`                       |
| Target rule delta     | `<added> / <removed>`                       |
| False positives found | `<count after manual inspection>`           |
| Output artifacts      | `<baseline.ndjson, candidate.ndjson, JSON>` |

## Test plan

- `<focused test command>`
- `<typecheck command>`
- `<lint/format command or Not run>`
````

Do not include the eval table if full PR parity was not run; state the skip reason.

## Changeset

Generate a changeset after validation and before PR copy for user-facing changes to published packages.

Required handling:

- Use `nr changeset` unless the user explicitly asks for a manual file.
- Select the affected published package or packages.
- Use `patch` for new rules, bug fixes, false-positive fixes, diagnostic wording changes, and test-backed behavior refinements unless the release impact clearly requires otherwise.
- Summarize the user-visible behavior, including the rule name and the runtime problem it catches or avoids.
- Skip the changeset only for private-only, docs-only, test-only, or tooling-only changes, and record why it was skipped.

## Review Comment Triage

Classify each bot or human review comment:

- Fix now: real false positive, false negative for claimed behavior, AST mistake, scope/binding bug, or reasonable control-flow bug.
- Usually fix: duplicated helper, misleading name, unnecessary abstraction, or confusing comment.
- Document or defer: false-negative coverage outside v1, path explosion, complex unsupported control flow, or imported file analysis.
- Reject: broadens the rule beyond its message, increases false positives, or conflicts with repo conventions.

Resolve review threads only after the fix or explanation has landed.

## Validation Output

Return:

```md
Validation summary:

- <commands and results>
- <implementation review findings>
- <local RDE summary or skip reason>
- <full PR parity summary or exact blocker>
- <false positives found and fixed>
- <regression tests added>
- <changeset path or skip reason>

PR-ready notes:

- <Why/What/Test plan highlights>

Residual risk:

- <known v1 non-goals or unchecked areas>
```
