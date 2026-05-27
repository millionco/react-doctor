---
name: rule-pr-writer
description: Write clear PR descriptions for React Doctor rule changes. Use when opening or revising a rule PR, summarizing eval evidence, adding before/after examples, or creating a PR-ready test plan.
---

# Rule PR Writer

Use this after the rule implementation and validation steps are complete.

## PR Structure

Write:

- `Why`
  - Start with "Catches <specific issue>."
  - Explain the runtime reason in 1-3 sentences.
  - Include a bad before example.
  - Include a good after example.
- `What changed`
  - Name the rule.
  - Name the detection surface.
  - Name important valid patterns the rule allows.
  - Mention adversarial tests.
- `Eval results`
  - Include when RDE was run.
  - Distinguish distinct repos from rootDir scans.
  - Include false-positive count and inspection method.
- `Test plan`
  - Focused tests.
  - Typecheck.
  - Lint or format when run.

## Rules

- Lead with user-facing value, not implementation internals.
- Do not overclaim beyond v1 scope.
- Keep before/after examples small.
- Include eval evidence for broad or heuristic rules.
- Say "Not run" for checks that were not run.

## Reference

For full PR description guidance, read `docs/HOW_TO_WRITE_A_RULE.md`.

For eval table examples and PR body templates, read `examples.md`.
