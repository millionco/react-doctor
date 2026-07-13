---
name: fuzz
description: Adversarially fuzz React Doctor rules with @react-doctor/fuzz — crash, slowness, and metamorphic-invariance oracles over generated, pathological, and real-world programs. Use after rule tests pass, when hunting false positives, when triaging a fuzz finding, or whenever a NEW false positive is confirmed from any source (user report, RDE eval, react-bench run, review) so it gets added to the evolving regression corpus.
---

# Fuzz

Stage 3½ of the rule pipeline — runs alongside `rule-validate`:

1. `rule-research` defines the rule contract.
2. `rule-writing` turns the contract into tests and implementation.
3. `rule-validate` verifies noise, correctness, changesets, PR copy.
4. **`fuzz`** stress-tests the implementation mechanically and keeps a
   permanent, growing memory of every false positive ever confirmed.

The harness lives in `packages/fuzz` (`@react-doctor/fuzz`, private). Read
its `README.md` for architecture; this skill is the operating manual.

## Run

```bash
pnpm fuzz                                   # all rules, crash+slow oracles
FUZZ_RULE=<id substring> pnpm fuzz          # one rule / one family
FUZZ_ITERATIONS=200 FUZZ_SEED=42 pnpm fuzz  # more cases, fixed seed
FUZZ_INVARIANTS=1 pnpm fuzz                 # + metamorphic + verdict-drop oracles (warn)
FUZZ_STRICT=1 pnpm fuzz                     # fail on invariant violations + verdict drops
FUZZ_CORPUS_DIR=<dir of repos> pnpm fuzz    # + real files & crossover
FUZZ_PRINT_SILENT=1 pnpm fuzz               # list rules that never fired
```

Recommended validation run for a new or changed rule:

```bash
FUZZ_RULE=<rule-id> FUZZ_STRICT=1 FUZZ_ITERATIONS=500 pnpm fuzz
```

Recommended full sweep (e.g. before a rule-batch release), pointing the
corpus at real checkouts. Ready-made corpora work on any machine — see the
package README "Canonical corpora": `bun scripts/sync-fuzz-corpus.ts`
materializes a pinned 48-repo sample (symlinking the RDE cache when
present, cloning otherwise), and `bun scripts/build-bench-corpus.ts`
extracts react-bench's diagnostic-dense RD-health target files:

```bash
cd packages/fuzz && bun scripts/sync-fuzz-corpus.ts
FUZZ_INVARIANTS=1 FUZZ_ITERATIONS=100 FUZZ_CORPUS_DIR=packages/fuzz/tmp/corpus-repos pnpm fuzz
```

The direct FP oracle — every regression-corpus seed is ground-truth-valid
code, so ANY rule firing on an unmutated seed is a signal:

```bash
cd packages/fuzz && bun scripts/hunt-false-positives.ts
```

A seed's own named rule firing = reintroduced regression (hard fail). Any
OTHER pipeline-enabled rule firing = FP candidate; triage each against the
seed code (incidental violations in minimal seeds are true positives —
e.g. an unlabeled `<button>` — but cross-rule hits on the seed's core
idiom have repeatedly exposed real bugs: a stale ARIA role→props table,
useLayoutEffect treated as post-paint, async-useCallback opacity).
`HUNT_CORPUS_DIR=<repos>` appends a hit census over real files for
noise-ranking rules.

## Fire-coverage doctrine

The run prints `fuzz fire-coverage: N/total rules produced a diagnostic`.
**A rule that never fires is only having its early bails fuzzed** — its
"survived fuzzing" result proves almost nothing. When validating a specific
rule, first confirm it FIRES under fuzz:

```bash
FUZZ_RULE=<rule-id> FUZZ_PRINT_SILENT=1 pnpm fuzz
```

If it is silent, add a triggering shape to the generator before trusting
any fuzz result: extend the matching domain pool in
`packages/fuzz/src/snippet-pools.ts` (effects, state, handlers, guards,
library idioms, JSX attributes/leaves, module scope) with a snippet that
uses the shared lexicon (`state`/`setState`, `items`, `value`, `url`,
`handle`, `containerRef`, …). Tune with the measurement scripts:

```bash
cd packages/fuzz
bun scripts/measure-coverage.ts          # generator fire-coverage
bun scripts/measure-corpus-coverage.ts   # corpus fire-coverage
```

## Triage playbook (real cases)

Findings write reproducers to `packages/fuzz/tmp/fuzz-findings/` with
rule/kind/seed headers. Every case replays from its seed alone.

**crash** — always a real bug; rules must never throw on parseable input.

1. Re-run just that rule and seed: `FUZZ_RULE=<id> FUZZ_SEED=<seed> FUZZ_ITERATIONS=1 pnpm fuzz`.
2. Minimize the reproducer by deleting sections while the crash persists.
3. Add the minimized program as an invalid-or-valid regression test in the
   rule's own `.test.ts` (asserting no throw), fix the visitor (typical
   causes: missing null check on `parent`, assuming a member is an
   Identifier, assuming trigger token implies full context).
4. Re-run the seed to confirm green.

**slow** — quadratic scans or unbounded recursion.

1. Check which pathological shape the reproducer is (deep JSX, long chain,
   wide siblings). Profile the rule on it.
2. Fix by bounding the walk (depth caps, single-pass caching, early exits).
3. Keep the threshold honest — do not raise `SLOW_RULE_THRESHOLD_MS` to
   make a finding disappear.

**verdict-drop** — the mutation-robustness oracle: the rule FIRED on a
program, then a verdict-preserving shape rewrite silenced it entirely.
The catalog lives in `src/verdict-preserving-variants.ts` and rewrites the
program the way an evading (or just differently-styled) author would:
parenthesized/`as any`/non-null call receivers, concise arrows converted
to block returns, a no-op `void 0;` prologue in every function body
(must-preserve tier), plus optional-chained and computed-member call
spellings (advisory tier — those are documented static-analysis
boundaries). Triage exactly like a false negative: the code still contains
the defect, so the detection was keying on incidental token shape. Fix at
the shared util when possible (`stripParenExpression` on receivers,
`getCallbackStatements` no-op filtering, `isGlobalMethodCall`) so every
rule inherits it. Two standing harnesses:

- `packages/fuzz/tests/verdict-robustness.test.ts` — enforced gate: each
  audited rule's liveness fixture must keep firing under every
  must-preserve rewrite. Add your rule id to `AUDITED_RULE_IDS` when you
  harden a rule; never fix a failure by allowlisting unless the drop is
  the rule's documented semantics.
- `bun scripts/measure-verdict-robustness.ts` — advisory registry-wide
  census over all liveness fixtures (`VERDICT_ADVISORY=1` adds the
  advisory tier). Use it to find the next brittleness cluster.

**invariant-violation** — the metamorphic oracle: a semantics-preserving
rewrite (comments, blank lines, trailing unused decl) changed diagnostics.

1. First decide: is the rule LEGITIMATELY shape-sensitive? (Scan rules
   matching comment content are excluded already; a rule that deliberately
   keys on parenthesization or statement counts may report differently.)
2. If not legitimate, the rule is keying off incidental source shape —
   usually offsets/ranges leaking into messages, statement-index
   assumptions, or comment nodes breaking sibling walks. Fix and add a
   regression test.
3. If legitimate, document why in the rule and (only then) consider an
   exemption list in the harness.

**false positive confirmed anywhere else** (user report via Plain, RDE
eval, react-bench A/B run, code review, adversarial review): treat it as a
fuzz finding of the highest value — feed the evolving loop below.

## The evolving loop (non-optional)

The fuzzer's power compounds through its regression corpus at
`packages/fuzz/corpus/regressions/`. Every file there is a confirmed false
positive — valid code a rule once wrongly flagged — and every fuzz run
mutates and crosses over these seeds, concentrating pressure on the
historically weakest detection logic. Confirmed true positives worth
keeping as mutation seeds go in `packages/fuzz/corpus/true-positives/`
instead; the harness enforces no firing expectations for either family
(those live in the rule's unit suite).

Whenever a NEW false positive is confirmed, before (or with) the rule fix:

1. Add a minimal reproducer:
   `packages/fuzz/corpus/regressions/<rule-id>--<slug>.tsx` with the header
   (see `packages/fuzz/corpus/README.md`): rule id, weakness class, source.
2. Run `pnpm test` in `packages/fuzz` — a smoke test enforces every seed
   parses cleanly.
3. If the FP exposes a NEW weakness class or a shape the generator cannot
   produce, also add a snippet to the matching pool in
   `src/snippet-pools.ts` (so mutation pressure applies to generated
   programs too, not just this one seed) and add the class to the catalog
   below.
4. Add the standard regression test in the rule's own `.test.ts` (the
   corpus seed complements it, never replaces it).

The same applies in reverse: when a fuzz invariant finding is confirmed as
a real bug, promote its reproducer from `tmp/fuzz-findings/` into
`corpus/regressions/` after minimizing.

## False-positive trick catalog

Weakness classes ranked by historical frequency (mined from every FP fix
in git history, 200+ FP-mentioning PRs, and all Cursor/Claude session
logs). When writing or reviewing a rule, attack it with each class; when
fuzz-triaging, use the class to name the corpus seed.

| class                    | the trick                                                | canonical examples                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **library-idiom**        | the "violation" is a library's documented API shape      | `observer(() => hooks)`, `track()(fn)`, `create*Container`, `Promise.resolve().then` microtask, styled/emotion templates, `?? 0 - getTimezoneOffset()` negation, split-fragment index keys, download/`target="_blank"` anchors |
| **control-flow**         | a guard/branch/lifecycle the rule's walk doesn't connect | visibility gates (`showX && <JSX window…/>`), cancellation flags, cleanup-only setters, loop-variant construction (`new RegExp(t, flags)` in loop), statically bounded sources (`Array(4)`), catch-path resets via helper      |
| **wrapper-transparency** | a wrapper forwards what the rule demands                 | `{...props}` can carry `type`/`onChange`/children/`name`; `memo`/`forwardRef`/factory callbacks; TS `as`/`satisfies`/paren wrappers                                                                                            |
| **name-heuristic**       | naming implies a different kind than the pattern assumes | `showMenu` prop that is a callback not a flag; `INIT_TIMESTAMP` per-process constant; `aria-label`/`aria-labelledby` as accessible names; boolean var named `count`                                                            |
| **alias-guard**          | the value is guarded through another binding             | `const price = item?.price; if (!price) return; item?.price * 2`; renamed destructuring (`{ type: kind }`); local const resolving to a valid literal                                                                           |
| **cross-file**           | the proof lives in another module                        | imported `canUseDOM`/`IS_BROWSER`; escape helpers defined elsewhere; cross-file const endpoints; caller-side try/catch                                                                                                         |
| **framework-gating**     | valid only/never under a framework context               | SSR-only rules in client-only code; Next `opengraph-image.tsx` rendered via `next/og`; Next 15 async API rules on Next 14; test/story/e2e paths                                                                                |
| **paren-shape**          | parenthesization or token shape flips meaning            | `x ?? (0 / y)` vs `x ?? 0 / y` (note: oxlint parses with `preserveParens: false` — paren detection must be positional/range-based, never rely on ParenthesizedExpression nodes)                                                |
| **dynamic-computed**     | computed member/call defeats static naming               | `items[index]()` in deps; `obj["use" + "State"]`; computed removal method                                                                                                                                                      |
| **copy-tracking**        | a fresh copy is mutated, not the original                | `[...items].sort()`, `items.slice()`, `Array.from(x)`, `structuredClone`, spread-then-mutate-then-set                                                                                                                          |

Out of this fuzzer's scope (route to core tests instead): dead-code /
dependency analyzers' FP classes — subpath imports
(`@hookform/resolvers/zod`), barrel re-export chains, peer-dependency
satisfaction, config-file-only references (postcss/tailwind), pnpm
overrides, `baseUrl` resolution, dynamic-import template paths. These had
the worst measured FP rates historically (up to ~75% for
unused-dev-dependency) but are project-level scans, not oxlint rules.

## Reporting

Fold fuzz results into rule-validate's validation summary:

```md
Fuzz:

- command: <exact env + command>
- fire-coverage: <did the target rule fire? N programs>
- findings: <none | list with kinds and seeds>
- corpus seeds added: <paths or none>
- pool snippets added: <yes/no + domain>
```
