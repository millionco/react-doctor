---
name: rule-validate
description: Validate an implemented React Doctor rule before merge. Use after focused tests pass to review detector correctness, inspect open-source hits, run pull request parity, add regression coverage, prepare a changeset, write pull request copy, or address review findings.
---

# Validate a rule

Verify that the implementation matches its `rule-research` contract on tests and real code.

## Review the implementation

Check for:

- false positives and missed claimed behavior
- incorrect imports, aliases, or shadowed bindings
- impossible control-flow path merges
- nested functions treated as immediate execution
- dynamic properties treated as static names
- missed transparent wrappers
- unsupported imported values
- messages that overstate detection
- missing valid and invalid tests

Use `truffler` before accepting a new helper:

```sh
bunx @rayhanadev/truffler "<helper-name>" packages \
  --kind function,method,interface,type,constant --limit 20
```

Fix each implementation bug with a focused regression test.

## Run validation

Run focused tests, package typecheck, and required lint and format checks. Run broader checks when the change affects shared behavior.

Use `rde-eval` for bounded local inspection of the target rule. Inspect all hits when counts are low and a representative sample when counts are high. Add every confirmed false positive to rule tests and the `fuzz` corpus.

Run `run-parity` for every new rule or detector behavior change after the pull request head is pushed. Skip it for documentation-only or test-only changes. If parity cannot run, report the exact blocker.

Do not claim parity unless both Daytona runs complete. Compare repository and project-root counts separately. Inspect target-rule deltas before classifying them.

## Prepare release artifacts

Run `nr changeset` for user-visible changes to published packages. Use a patch changeset for rules, bug fixes, false-positive fixes, and diagnostic refinements unless release impact requires more. Skip only private, documentation, test, or tooling changes, and state why.

Write pull request copy after validation:

```md
## Why

<specific runtime problem>

## What changed

- <detector behavior>
- <valid patterns preserved>
- <tests added>

## Eval results

| Check             | Result                |
| ----------------- | --------------------- |
| Projects compared | `<count>`             |
| Skipped projects  | `<count>`             |
| Added / removed   | `<added> / <removed>` |
| Target rule delta | `<added> / <removed>` |
| False positives   | `<count>`             |
| Artifacts         | `<paths>`             |

## Test plan

- `<command and result>`
```

Omit the eval table when parity did not run. State the reason instead.

## Handle review findings

Fix correctness bugs, duplicated helpers, misleading names, and confusing code. Defer unsupported control flow only when it falls outside the contract. Reject requests that broaden the message or increase false positives.

Resolve review threads after the fix or explanation reaches the pull request.

## Report validation

Report commands, review findings, local RDE evidence, parity results or blocker, false positives fixed, regression tests, changeset, pull request notes, and residual non-goals.
