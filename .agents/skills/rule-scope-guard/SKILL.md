---
name: rule-scope-guard
description: Keep React Doctor rule implementations narrowly scoped. Use when defining v1 behavior, rejecting scope creep, separating adjacent rule ideas, or documenting non-goals.
---

# Rule Scope Guard

Use this to prevent noisy v1 rules.

## Scope Questions

Ask:

- What exact condition does the diagnostic claim?
- What similar issue is not the same rule?
- Which examples should stay quiet?
- Which unknowns should be skipped?
- Which future rule should own adjacent behavior?

## V1 Scope Format

Return:

- In scope
- Out of scope
- Separate future rule ideas
- Required tests for non-goals
- Diagnostic wording adjustments

## Rules

- Do not broaden a rule beyond its message.
- Do not include lower-confidence adjacent bugs in a high-confidence rule.
- Do not preserve support for unimplemented branch behavior by adding shims.
- Prefer explicit TODOs over pretending unsupported control flow is modeled.
- Treat false positives as correctness bugs.

## Example

For `no-mutating-reducer-state`, do not include:

```tsx
state.user.name = "Ada";
return { ...state };
```

This mutates nested state but returns a new top-level object. It needs separate rule wording.

## Reference

For v1 scope examples, read `docs/HOW_TO_WRITE_A_RULE.md`.

For examples of v1 vs future-rule boundaries, read `examples.md`.
