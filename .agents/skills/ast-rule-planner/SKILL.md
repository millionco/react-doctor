---
name: ast-rule-planner
description: Plan AST, scope, and control-flow detector logic for React Doctor rules. Use when turning a rule idea into implementation pseudocode or deciding which AST nodes, bindings, and paths matter.
---

# AST Rule Planner

Use this after the rule idea is validated and before implementation.

## Planning Steps

1. Restate the exact diagnostic condition.
2. Identify relevant AST node types.
3. Decide detector precision:
   - Syntax-only
   - Scope-aware
   - Path-aware
4. Identify required binding checks.
5. Identify shadowing and import-alias risks.
6. Identify nested structures to skip or model.
7. Write pseudocode before editing files.
8. List unsupported v1 cases.

## AST Checks

Consider:

- `ImportDeclaration`
- `ImportSpecifier`
- `Identifier`
- `MemberExpression`
- `CallExpression`
- `AssignmentExpression`
- `ReturnStatement`
- `IfStatement`
- `SwitchStatement`
- Transparent wrappers such as `ParenthesizedExpression`, `TSAsExpression`, and `ChainExpression`

## Output

Return:

- AST vocabulary table for the rule
- Detector precision level
- Required binding/scope checks
- Pseudocode
- V1 non-goals
- Test implications

## Reference

For the canonical rule-writing guide, read `docs/HOW_TO_WRITE_A_RULE.md`.

For concrete detector plans and pseudocode examples, read `examples.md`.
