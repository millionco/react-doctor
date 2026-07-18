---
name: rule-research
description: Research and scope React Doctor rule ideas before implementation. Use when validating a proposed rule, grounding it in docs, OSS examples, RDE evidence, false-positive traps, detector precision, or v1 non-goals.
---

# Rule Research

Use this as stage 1 of the React Doctor rule pipeline.

Pipeline:

1. `rule-research` defines the rule contract.
2. `rule-writing` turns the contract into tests and implementation.
3. `rule-validate` verifies noise, correctness, PR copy, and review feedback.
4. `run-parity` compares the finished PR against its base across the full corpus.

Do not start implementation until the rule contract is clear. If the user already asked you to implement, make the contract concise and continue.

## Interactive Coaching

Start by asking only for missing information that blocks a useful contract:

- What code pattern should be reported?
- What runtime, framework, or library behavior makes it a bug?
- What similar-looking code should stay quiet?
- Is this meant to be syntax-only, scope-aware, or path-aware?
- Should v1 skip imported, dynamic, type-driven, or interprocedural cases?

When enough is known, present a short rule contract and either ask for confirmation or continue if the user already requested implementation.

## Research Workflow

1. Define the rule in one sentence:
   `This rule catches <code pattern> that causes <specific problem>.`
2. Explain the runtime reason in plain language.
3. Inspect existing React Doctor rule patterns before inventing a shape:
   - `packages/oxlint-plugin-react-doctor/src/plugin/rules/`
   - `packages/oxlint-plugin-react-doctor/src/plugin/utils/`
   - `packages/oxlint-plugin-react-doctor/src/plugin/rule-registry.ts`
   - Existing co-located `*.test.ts` files.
   - Use `truffler` (the `find-similar-functions` skill) to fuzzy-search these paths for an existing rule, detector, or utility by symbol name before assuming a behavior is new: `bunx @rayhanadev/truffler "<symbol or behavior>" packages/oxlint-plugin-react-doctor/src/plugin --kind function,interface,type,constant --limit 20`
4. Collect evidence:
   - Official docs.
   - Runtime or implementation notes.
   - Real app examples.
   - Similar linter rules.
   - Accepted debugging answers.
   - OSS code that looks suspicious but is valid.
5. Classify examples:
   - Strong positive: exact bug the rule should catch.
   - Pattern-adjacent: related issue for a separate rule.
   - False-positive trap: valid code that must stay quiet.
   - Out of scope: too dynamic, imported, semantic, or unsupported for v1.
6. Decide detector precision:
   - Syntax-only: local syntax is enough.
   - Scope-aware: imports, aliases, or shadowed bindings matter.
   - Path-aware: order, branches, or same-path conditions matter.
7. Choose the validation path:
   - Use `rde-eval` locally for targeted OSS evidence while the rule is still uncommitted.
   - Use `run-parity` after a PR exists for an exact base/head full-corpus comparison.

## RDE Idea Prompt

Use this prompt shape when asking an eval or research agent to search OSS:

```md
Find real-world evidence for a React Doctor rule:

Rule: `<rule-name>`

Goal:
Find examples where <exact bug definition>.

Return:

- Strong positive examples
- Pattern-adjacent examples
- False-positive traps
- Detector implications
- Suggested adversarial tests

Prefer examples tied to real framework/library usage.
Do not treat similar-looking valid code as a positive.
```

## Validation Plan

Do not run full PR parity during idea research. Record the intended handoff:

- Use local `rde-eval` when OSS evidence would change the contract.
- After implementation, tests, and a pushed PR head, invoke `Use $run-parity for PR <number-or-url>`.
- Default full PR parity to required for a new rule or a behavior change to an existing rule. Record a concrete skip reason when credentials, a PR, or the Daytona service are unavailable.

## Rule Contract Output

Return this contract at the end of research:

```md
Rule definition:
This rule catches <code pattern> that causes <specific problem>.

Runtime reason:
<1-3 sentences>

Detector precision:
Syntax-only | scope-aware | path-aware

Evidence:

- <docs, OSS, issue, RDE, or similar-tool evidence>

Strong positives:

- <exact reportable examples>

False-positive traps:

- <valid examples that must stay quiet>

In scope for v1:

- <supported cases>

Out of scope for v1:

- <explicit non-goals>

Test seeds:

- <invalid and valid fixture ideas>

Validation plan:

- <local RDE scope and whether full PR parity is required>

Open questions:

- <only questions that affect correctness or scope>
```

## Research Rules

- Treat false positives as correctness bugs, not acceptable noise.
- Do not broaden a rule beyond its diagnostic message.
- Split adjacent ideas into future rules instead of weakening v1 precision.
- Prefer explicit non-goals over pretending unsupported control flow is modeled.
- Preserve the rule contract for the writing and validation stages.
