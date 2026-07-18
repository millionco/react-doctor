---
name: rule-writing
description: Implement React Doctor rules from a validated contract. Use when writing oxlint rules, planning syntax or control-flow detection, designing adversarial tests, reusing syntax tree utilities, or updating rule registration.
---

# Write a rule

Implement the `rule-research` contract. If none exists, define a compact contract before editing.

## Plan the detector

State the diagnostic condition, required syntax and bindings, unsupported cases, and adversarial tests. Keep this plan short when the user already requested implementation.

Before adding a helper, search for one to reuse:

```sh
bunx @rayhanadev/truffler "<symbol-or-behavior>" \
  packages/oxlint-plugin-react-doctor/src/plugin \
  --kind function,interface,type,constant --limit 20
```

Read `docs/HOW_TO_WRITE_A_RULE.md`, nearby rules, utilities, and tests.

## Implement and test

1. Write detector pseudocode.
2. Add adversarial valid and invalid tests.
3. Implement only the contract's supported behavior.
4. Reuse utilities before creating new ones.
5. Update generated registration with repository commands.
6. Run focused tests and package checks.
7. Use `rde-eval` when real-code feedback could expose noise.
8. Hand the finished change to `rule-validate`.

Account for:

- import aliases and shadowed bindings
- nested functions that do not execute immediately
- transparent JavaScript and TypeScript wrappers
- dynamic computed properties
- imported or unresolved values
- framework escape hatches
- control-flow paths required by the diagnostic claim
- regressions found by reviews or evals

Keep uncertain cases quiet. Match the message to the condition the detector proves.

## Run repository checks

Use `@antfu/ni` commands:

```sh
nr test
nr lint
nr typecheck
nr format
nr smoke:json-report
```

Use focused commands while iterating. Record each command that ran.

## Report the implementation

Report changed rules, tests, registration, reused or added utilities, reported behavior, intentional non-goals, and validation results. End with the `rule-validate` handoff.
