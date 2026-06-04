---
name: rule-writing
description: Write React Doctor rules from a validated rule contract. Use when implementing oxlint plugin rules, planning AST/scope/control-flow detection, designing adversarial tests, adding utilities, or updating rule registration.
---

# Rule Writing

Use this as stage 2 of the React Doctor rule pipeline.

Pipeline:

1. `rule-research` defines the rule contract.
2. `rule-writing` turns the contract into tests and implementation.
3. `rule-validate` verifies noise, correctness, PR copy, and review feedback.

If no rule contract exists, create a compact one first or use the research skill before editing.

## Interactive Coaching

Before substantial edits, show the implementation plan:

- Exact diagnostic condition.
- Detector precision: syntax-only, scope-aware, or path-aware.
- AST nodes and bindings that matter.
- Unsupported v1 cases.
- Adversarial test matrix.

If the user asked for direct implementation, keep the plan short and proceed.

## Implementation Workflow

1. Read the rule contract and `docs/HOW_TO_WRITE_A_RULE.md` when available.
2. Inspect nearby rules and utilities before adding new abstractions. Use `truffler` (the `find-similar-functions` skill) to fuzzy-search for an existing detector or utility to reuse or extend before writing one: `bunx @rayhanadev/truffler "<symbol or behavior>" packages/oxlint-plugin-react-doctor/src/plugin --kind function,interface,type,constant --limit 20`.
3. Write detector pseudocode before editing files.
4. Write or update adversarial tests first when practical.
5. Implement the detector to match the rule contract exactly.
6. Add or reuse focused utilities only when they remove real duplication or encode subtle AST semantics.
7. Update generated registry or metadata using the repository's existing commands.
8. Run focused tests, then package checks as appropriate.

Use `@antfu/ni` commands in this repo:

```sh
nr test
nr lint
nr typecheck
nr format
nr smoke:json-report
```

Use narrower package or file-specific commands when iterating, then record what passed.

## Detector Planning

Plan against real AST behavior:

- Use node fields, not source-text string matching.
- Resolve imports and bindings when identifier identity matters.
- Treat shadowed bindings as different variables.
- Skip imported or unknown code unless v1 explicitly supports it.
- Do not walk nested functions as if they execute immediately.
- Strip transparent wrappers when needed, such as parentheses, TypeScript wrappers, and optional-chain wrappers.
- Treat dynamic computed properties as unknown unless the static value is provable.
- Model only the control flow needed for the diagnostic claim.

Pseudocode shape:

```ts
for each file:
  collect framework/library imports and aliases
  find candidate syntax
  resolve bindings needed for identity
  skip unsupported or unknown cases
  analyze only the local paths required by the rule
  report only when the exact diagnostic condition is proven
```

## Adversarial Test Matrix

Design varied invalid and valid cases:

- Direct invalid cases.
- Alias invalid cases.
- Import alias and namespace import cases.
- Same-looking valid cases.
- Scope shadowing.
- Nested functions that should not be treated as immediate execution.
- Dynamic computed properties.
- Imported or unresolved references.
- Framework or library escape hatches.
- Regression cases from review or eval findings.

Include valid tests for v1 non-goals so the rule stays quiet where it should.

## Code Quality Rules

- Match the detector to the one-sentence rule definition.
- Match the diagnostic message to the exact reported condition.
- Use descriptive helper names that state precise semantics.
- Avoid comments unless they explain non-obvious control flow, lossy modeling, or v1 boundaries.
- Put shared subtle AST helpers in `utils/` only when there is real reuse.
- Keep the implementation conservative when precision is uncertain.

## Writing Output

When the writing stage is done, report:

```md
Implemented:

- <rule, tests, registry, utilities>

Detector behavior:

- <what reports>
- <what intentionally stays quiet>

Validation run:

- <focused tests/checks>

Known v1 non-goals:

- <unsupported cases preserved from the rule contract>

Next stage:

- Run `rule-validate`.
```
