---
name: reproer
description: Turn React Doctor `rule.evidence` telemetry events or identifier-redacted token patterns into synthetic, parseable React/TypeScript repro hypotheses and fuzz cases. Use when investigating possible false positives or false negatives from an `evidence.pattern`, reconstructing a minimal rule-triggering shape, producing adversarial variants, or promoting a verified hypothesis into the React Doctor fuzz corpus.
---

# Reproer

Generate synthetic programs that could produce the supplied token pattern. Treat every result as a hypothesis, never as recovered source.

## Protect the privacy boundary

- Never claim to reconstruct the original code. The mapping from source to evidence is many-to-one.
- Never search GitHub, the internet, or private repositories to identify a matching source unless the user explicitly requests that separate investigation.
- Invent neutral identifiers and literal values. Do not guess names, domains, secrets, UI copy, package names, or repository identity.
- Preserve an `identifier_N` equality relationship only within one candidate. Do not correlate placeholders across events.
- Keep the telemetry event out of committed fixtures. Commit only synthetic code written from the structural hypothesis.
- Describe reconstruction confidence as structural fidelity, not source fidelity.

## Require the useful inputs

Collect these fields when available:

```text
rule
evidence.pattern
evidence.fileContext
evidence.tokenCount
evidence.truncated
category
severity
```

Require `rule` and `evidence.pattern`. Ask for either field if missing because the rule supplies semantics that the anonymized identifiers no longer carry.

## Build repro hypotheses

1. Locate and read the target rule, its metadata, focused tests, and any existing fuzz fixtures. Use `rg` with the short rule ID.
2. Read `.agents/skills/fuzz/SKILL.md` and `packages/fuzz/README.md` before running the harness or modifying its corpus.
3. Decode the pattern conservatively:
   - Map each `identifier_N` to one neutral role name and reuse it within the candidate.
   - Replace `string_literal`, `number_literal`, `boolean_literal`, `null_literal`, `bigint_literal`, `regular_expression_literal`, and `template_literal` with harmless canonical values.
   - Preserve keywords, operators, delimiters, member access, calls, and identifier-equality relationships.
   - Treat `syntax_N` as unknown until checking the matching TypeScript `SyntaxKind`.
   - Add the smallest component, hook, import, or function wrapper needed to parse and exercise the rule.
   - When `evidence.truncated` is true, close the program into a valid minimal shape without pretending the invented suffix matches the source.
4. Produce a small hypothesis matrix:
   - **Nearest shape:** retain the observed token order with only parseability scaffolding.
   - **Valid-context shape:** place the syntax in the most ordinary legitimate React or TypeScript context.
   - **False-positive probe:** create a valid program where the suspicious shape is intentional or safe.
   - **False-negative probes:** change one dimension at a time, such as aliasing, wrappers, optional chaining, parentheses, control flow, TypeScript syntax, JSX placement, or cross-statement data flow.
5. Generate three to eight candidates. Avoid a combinatorial matrix until one candidate reaches the rule's reporting path.

## Verify instead of guessing

Place initial candidates in a temporary directory or an existing focused test harness. Do not add corpus files before checking the verdict.

For every candidate, record:

- whether it parses;
- whether the target rule fires;
- the diagnostic span and message;
- the intended semantic verdict: valid, invalid, or uncertain;
- the mutation dimension that distinguishes it from the nearest shape.

Do not call a case a false positive or false negative from telemetry alone. Confirm the rule contract and the program's semantics first.

Run the narrowest focused rule test. After it passes, run the targeted fuzzer:

```sh
FUZZ_RULE=<short-rule-id> FUZZ_STRICT=1 FUZZ_ITERATIONS=500 nr fuzz
```

Confirm that the target rule fires at least once. A silent run validates only early exits.

## Promote verified cases

- For a confirmed false positive, add a minimal focused valid case and `packages/fuzz/corpus/regressions/<rule-id>--<weakness>.tsx` with `// verdict: pass`.
- For a confirmed true positive or liveness seed, add a minimal focused invalid case and use `packages/fuzz/corpus/targets/` when the harness needs a reporting-path seed.
- For a confirmed false negative, add the missing invalid case to the focused rule tests, fix the detector when requested, and add a generator snippet only when existing pools cannot produce the weakness.
- Use stable weakness names from the fuzz skill. Never label an unverified hypothesis as a regression.
- Run the focused test, `nr -C packages/fuzz test`, and replay the target rule after changing the corpus.

## Report the result

Return:

1. the normalized evidence skeleton;
2. the synthetic candidates and their structural-fidelity notes;
3. the observed rule verdict for each candidate;
4. confirmed FP, FN, or liveness findings, clearly separated from hypotheses;
5. tests, fuzz commands, seeds, and files changed.

State explicitly that the candidates do not recover identifiers, literals, comments, paths, or repository identity.
