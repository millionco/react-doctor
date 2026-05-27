---
name: rule-implementation-reviewer
description: Review React Doctor rule implementations for correctness, false positives, scope bugs, AST mistakes, and missing regression tests. Use before opening a PR or when reviewing a new rule diff.
---

# Rule Implementation Reviewer

Use this as a focused code-review pass for rule implementations.

## Review Priorities

Check:

- The detector matches the one-sentence rule definition.
- The diagnostic message matches the actual condition.
- Identifier names are resolved through bindings when needed.
- Shadowed bindings are handled.
- Imported or unknown code is skipped unless explicitly supported.
- Nested functions are pruned unless intentionally modeled.
- `if`, `switch`, and block handling do not merge impossible paths.
- Dynamic computed properties are not treated as static names.
- Transparent wrappers are unwrapped when needed.
- Utilities remove real duplication and do not hide simple logic.
- Tests cover every risky branch.

## Finding Categories

Lead with:

- False positives
- False negatives for claimed behavior
- Scope/binding bugs
- Control-flow bugs
- AST shape mistakes
- Missing tests

## Output

Return review findings with:

- Severity
- File reference
- Exact risk
- Minimal reproducing code snippet
- Suggested fix
- Suggested regression test

## Reference

For review-triage categories, read `docs/HOW_TO_WRITE_A_RULE.md`.

For concrete review findings from rule PRs, read `review-examples.md`.
