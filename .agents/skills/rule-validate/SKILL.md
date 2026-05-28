---
name: rule-validate
description: Validate implemented React Doctor rules before PR or merge. Use after rule tests pass to review correctness, run RDE against OSS, inspect false positives, write PR descriptions, and triage bot or human review comments.
---

# Rule Validate

Use this as stage 3 of the React Doctor rule pipeline.

Pipeline:

1. `rule-research` defines the rule contract.
2. `rule-writing` turns the contract into tests and implementation.
3. `rule-validate` verifies noise, correctness, PR copy, and review feedback.

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

Fix every real implementation bug with a targeted regression test.

## RDE Rule Validation

Use RDE after implementation when the rule is broad, heuristic, scope-aware, path-aware, or touches common React idioms.

Required handling:

- Scan distinct repos, not just manifest entries.
- Record rootDir scan count separately from repo count.
- Filter output to the target rule before judging results.
- Inspect every hit manually when counts are low.
- Sample hits manually when counts are high.
- Add regression tests for false positives found by evals.

Record:

```md
React Doctor checkout:
RDE eval harness:
Repo manifest:
Distinct repos scanned:
RootDir scans:
Target rule:
Filtered output:
Target diagnostics:
Manually inspected hits:
False positives found:
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

| Check                 | Result                             |
| --------------------- | ---------------------------------- |
| Repos scanned         | `<distinct repo count>`            |
| RootDir scans         | `<manifest/rootDir entries>`       |
| Target rule           | `<rule-name>`                      |
| Diagnostics           | `<target-rule diagnostics>`        |
| False positives found | `<count after manual inspection>`  |
| Output artifact       | `<filtered JSONL or summary path>` |

## Test plan

- `<focused test command>`
- `<typecheck command>`
- `<lint/format command or Not run>`
````

Do not include the eval table if RDE was not run; state why it was skipped when useful.

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
- <RDE summary or skip reason>
- <false positives found and fixed>
- <regression tests added>

PR-ready notes:

- <Why/What/Test plan highlights>

Residual risk:

- <known v1 non-goals or unchecked areas>
```
