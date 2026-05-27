---
name: adversarial-test-designer
description: Design adversarial test suites for React Doctor rules. Use before or during rule implementation when the user needs varied valid and invalid cases, false-positive traps, or eval-derived fixtures.
---

# Adversarial Test Designer

Use this before trusting a rule implementation.

## Test Matrix

Generate tests for:

- Direct invalid cases
- Alias invalid cases
- Import alias cases
- Namespace import cases
- Same-looking valid cases
- Scope shadowing
- Nested functions
- Dynamic computed properties
- Imported/unresolved references
- Framework or library escape hatches
- Regression cases from review comments

## Rules

- Do not only test the happy-path bug.
- Include valid examples that look suspicious.
- Include examples derived from real OSS code when available.
- Include tests for v1 non-goals so they stay quiet.
- Prefer diverse syntax shapes over repeated variants of one shape.

## Output

Return:

- Invalid test cases
- Valid test cases
- Edge-case categories
- Expected diagnostic counts
- Notes on which cases came from docs, OSS, RDE, or review

## Reference

For examples and test guidance, read `docs/HOW_TO_WRITE_A_RULE.md`.

For concrete invalid/valid fixtures and expected diagnostic count formats, read `examples.md`.
