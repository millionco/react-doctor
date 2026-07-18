---
name: rule-research
description: Define a precise React Doctor rule contract before implementation. Use when validating a rule idea, collecting official or open-source evidence, identifying false-positive traps, choosing detector precision, or setting first-version boundaries.
---

# Research a rule

Produce a rule contract that `rule-writing` can implement without guessing.

## Define the behavior

Resolve only questions that affect correctness:

- Which code pattern should report?
- Which runtime behavior makes it harmful?
- Which similar code must stay quiet?
- Does detection need syntax, scope, or path analysis?
- Which imported, dynamic, type-driven, or interprocedural cases stay out of scope?

If the user requested implementation, make the contract concise and continue.

## Collect evidence

1. Define the rule in one sentence: `This rule catches <pattern> that causes <problem>.`
2. Explain the runtime reason.
3. Inspect nearby rules, tests, utilities, and the generated registry.
4. Use `truffler` before proposing a new detector or helper:

   ```sh
   bunx @rayhanadev/truffler "<symbol-or-behavior>" \
     packages/oxlint-plugin-react-doctor/src/plugin \
     --kind function,interface,type,constant --limit 20
   ```

5. Gather official documentation, implementation notes, related linter behavior, and open-source examples.
6. Separate strong positives, adjacent patterns, valid traps, and unsupported cases.
7. Choose syntax-only, scope-aware, or path-aware detection.

Use `rde-eval` when a bounded open-source sample could change the contract. Leave final pull request parity to `rule-validate`.

## Write the contract

Return:

```md
Rule definition:
<pattern and specific problem>

Runtime reason:
<short explanation>

Detector precision:
<syntax-only, scope-aware, or path-aware>

Evidence:

- <source and implication>

Strong positives:

- <reportable examples>

False-positive traps:

- <valid examples>

In scope:

- <supported cases>

Out of scope:

- <explicit boundaries>

Test seeds:

- <invalid and valid fixtures>

Open questions:

- <correctness blockers only>
```

Treat false positives as correctness bugs. Keep the diagnostic narrower than or equal to the proven behavior. Split adjacent ideas into separate rules.
