---
name: rule-idea-validator
description: Validate proposed React Doctor rule ideas before implementation. Use when the user has a new lint rule idea, proposal, issue, or theory and needs to decide whether it should become a React Doctor rule.
---

# Rule Idea Validator

Use this before implementation.

## Workflow

1. Define the rule in one sentence:
   `This rule catches <code pattern> that causes <specific problem>.`
2. Explain the runtime/library behavior that makes it a bug.
3. Identify the intended diagnostic surface:
   - Syntax-only
   - Scope-aware
   - Path-aware
4. List exact positive examples.
5. List similar-looking valid examples.
6. Decide whether RDE idea validation is needed.
7. Recommend v1 scope and explicit non-goals.

## Output

Return:

- One-sentence rule definition
- Runtime reason
- Detector precision level
- Positive examples
- False-positive traps
- V1 scope
- V1 non-goals
- Whether to run RDE workflow one

## Reference

For full rule-authoring guidance, read `docs/HOW_TO_WRITE_A_RULE.md`.

For concrete good/bad rule definitions and a complete reducer example, read `examples.md`.
