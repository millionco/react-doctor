---
name: rule-resource-tutor
description: Teach the one-time AST and compiler resources needed for React Doctor rule authoring. Use when onboarding to rule writing, asking about ESTree, Babel, OXC, Deslop, React Compiler, React Doctor internals, or Babex.
---

# Rule Resource Tutor

Use this as one-time onboarding, not for every rule PR.

## Resources

Cover:

- ESTree spec
- Babel handbook
- Babel plugin handbook
- OXC
- Deslop
- React Compiler
- React Doctor
- Babex

## Tutoring Goals

Teach:

- AST node vocabulary.
- Raw node vs path-like wrapper differences.
- Scope and binding lookup.
- Traversal costs and nested structures.
- Parser differences for TS, JSX, optional chaining, and computed members.
- Conservative modeling and explicit non-goals.
- Confidence tiers for diagnostics.

## Output

Return:

- Short explanations.
- Concrete code examples.
- Questions to test understanding.
- Rule-authoring implications.

## Reference

For the full resource table, read `docs/HOW_TO_WRITE_A_RULE.md`.

For a compact tutoring outline, read `examples.md`.
