---
name: designing-for-agents
description: Use when deciding what React Doctor should catch or how to frame agent guidance — turning an observed agent failure into either a deterministic rule or a piece of judgment guidance. Catalogs the recurring ways coding and design agents fail, and the authoring techniques that actually change agent behavior. Pairs with rule-research (what to detect) and product-thinking (what to ship).
version: "0.1.0"
---

# Designing for Agents

React Doctor exists for one reason: agents write bad code in predictable ways, and deterministic tooling catches it. This skill is the layer above the rules — the catalog of *how* agents fail and how to turn each failure into a countermeasure that holds.

Not every agent failure is a rule. A linter can prove `useEffect(async () => …)` is wrong; it cannot prove an agent "reproduced the pixels instead of the data model" or "declared the build done without looking at it." Those are judgment failures. This skill helps you tell the two apart and write the right countermeasure for each.

The catalog below was mined from hard-won design-to-code and refactor skills. Each lesson is stated generically — it applies to any agent doing substantial work, not one tool.

## When to use

- You watched an agent produce bad output and want to systematize the fix.
- You are deciding whether a problem belongs in the **rule pipeline** or in **guidance** (a skill, a prompt, a diagnostic recommendation).
- You are writing a rule diagnostic or a skill and want it to actually change behavior instead of being ignored.

## The core decision: rule or guidance?

Classify every observed failure before you build anything.

| The failure is… | Route it to | Test |
|---|---|---|
| A **deterministic code shape** — provable from the AST or file tree | The rule pipeline (`rule-research` → `rule-writing` → `rule-validate`) | "Could I write a detector that's right every time?" |
| A **judgment lapse** — needs intent, the rendered result, or cross-artifact context | Guidance: a skill, a canonical prompt, or a rule's `recommendation` text | "Does catching this require knowing what the agent *meant* or *saw*?" |
| **Both** — a detectable symptom of a deeper judgment problem | A narrow rule for the symptom **and** guidance for the cause | Most real failures land here |

Reality check before you reach for a new rule: **the deterministic design surface is already mature.** The `design`, `react-ui`, and `a11y` categories already ship rules for most statically-detectable design mistakes (`no-tiny-text`, `no-gradient-text`, `no-z-index9999`, `no-redundant-size-axes`, …), and the backlog already tracks the obvious next ones. Search before proposing — most of what you observe is already a rule, already backlogged, or already deliberately dropped as too noisy. The genuinely new value is usually in the **guidance** column.

## The agent failure catalog

Each entry: the **principle** (what to do), the **failure** it counters, the **countermeasure**, and where it routes.

### Part A — How agents do the work

**1. Read the source of truth, not its rendering.** → guidance
Agents reason from lossy, derived views — a screenshot, a summary, a class literal that a transform has already invalidated — and produce output that is plausible and wrong. Identify the authoritative representation, force reading it, and ban inference from the convenient view. Know which oracle answers which question (the render shows what the user sees; the source holds the exact values).

**2. Reproduce the model, not the surface.** → guidance
When an artifact encodes a model — data, a schema, an intent — agents copy the rendered *form* and lose the *meaning*. A chart becomes a pile of rectangles; dimensions (ranges, segments, states) silently vanish. Recover the underlying model with full dimensionality first. A value with nowhere to live in your model is data you are dropping.

**3. A plausible substitute is silent drift.** → mostly guidance
Agents accept a close-enough stand-in — a fallback font, the nearest existing token, an eyeballed value — as if it were the real thing. The result looks right and is subtly wrong everywhere. Port the real asset or value; make a missing thing fail *visibly* rather than degrade silently.

**4. Decompose before you generate; survey the whole before the part.** → guidance
Agents emit monolithic output, discover structure too late, and duplicate patterns that recur across distant parts of the work. "I'll clean it up later" is not a workflow. Require a planning and decomposition pass, and a whole-corpus survey, *before* generation or mutation.

**5. Reuse before you create.** → both
Agents re-derive what already exists. Require a search of prior outputs, the local codebase, and the ecosystem before producing anything new. This is already a house rule here (`truffler` / `find-similar-functions` / `deslop`); the same discipline applies to every artifact an agent makes, not just utilities.

**6. Don't collapse distinct things into one parameterized mega-abstraction — and don't abstract deliberate deviations.** → both
Agents abstract by *superficial* similarity: one component that `switch`es on a `name` prop to render ten different SVG bodies; one token that swallows five distinct greys. Abstract shared *structure*; never merge distinct *content/artwork* or intentional one-offs. The boundary is sameness of meaning, not sameness of appearance.

**7. Match the mechanism's weight to the problem.** → both
Agents reach for heavyweight, runtime mechanisms to solve static problems — a hook and state to toggle a class that never changes at runtime. Use the lightest mechanism that works. State and effects are for behavior, not static appearance.

**8. Mechanize systematic edits; fix the generator, not the artifact.** → guidance
For a change that must land at N sites, agents hand-edit each one and drift between them; for generated output, they hand-fix the artifact that the next run overwrites. Produce a deterministic transform and apply it mechanically. When output is generated, fix the source.

**9. Verify the outcome, not a proxy — under controlled conditions.** → guidance
Agents declare done from reading the diff or seeing a green build. Verify the real artifact or behavior; control the comparison so the diff is meaningful (compare like for like). A passing build is necessary, not sufficient — a green check with a broken result is a failed task.

**10. Distinguish "I got it wrong" from "the target moved" — and never fabricate to close a gap.** → guidance
When output differs from a reference, agents either invent data to make it match or "fix" something that is actually a newer reference. Diagnose *why* the gap exists before acting. Forbid fabrication; require flagging the conflict for a human decision.

**11. Order work by leverage; collapse symptoms into the root cause.** → guidance
Agents chase many small differences and miss the single high-leverage one. Find and fix the biggest cause first; report one root cause instead of its many echoes. (This is `product-thinking`'s "root causes > individual warnings, fewer findings > more" applied to the agent's own process.)

### Part B — How to author the countermeasure

These come from the *structure* every durable agent skill shares. They are how you make a rule diagnostic or a skill actually change behavior.

**12. State the failure, not just the rule.** Open with the specific bad outcomes the guidance prevents and the good end-state ("RED/GREEN intent"). Agents act on consequences, not abstractions.

**13. Pre-enumerate the concrete bugs.** Name the specific traps the agent *will* hit, in advance ("the N bugs you will hit"). A named, anticipated failure changes behavior; a generic "be careful" does not.

**14. Close the escape hatches.** Tabulate the exact rationalization the agent will reach for — "it's simple enough to redo," "I'll componentize later," "the user only asked to paste it" — and pre-rebut each. Unrebutted, every one of these gets taken.

**15. Give a hard completion gate.** End with a literal "before you call this done, you MUST…" checklist. State that a skipped step is a failed task.

**16. Rank by corroboration.** When you have several independent sources demanding the same thing, say how many. Higher corroboration is higher confidence — and it is how you decide what to enforce hardest.

## Escape hatches closed

| You think | Do this instead |
|---|---|
| "This agent mistake should obviously be a rule." | Most are already a rule, backlogged, or dropped as noisy. Search first; default to guidance for judgment failures. |
| "I'll write a rule for the deeper problem." | A rule proves a code shape. If catching it needs intent or the rendered result, it's guidance — the rule can only catch a symptom. |
| "A medium-FP heuristic rule is good enough to ship." | False positives are correctness bugs here. Run it through `rule-research` and OSS evals before it ships, or keep it as guidance. |
| "Generic advice ('write clean components') will steer the agent." | It won't. Name the specific failure, the specific trap, and the rationalization to rebut. |
| "The lesson is obvious, it doesn't need a completion gate." | The obvious step is the one agents skip. Gate it. |
| "This is a Paper/design-specific lesson." | The principle generalizes. State it for any agent doing the work; keep the example concrete but the rule generic. |

## Before you call a failure handled, you MUST

1. Classify it as rule, guidance, or both — and say which.
2. For a rule: confirm it's deterministic and not already covered (search existing rules + backlog), then hand it to `rule-research`.
3. For guidance: state the failure and the good end-state, pre-enumerate the concrete traps, close the escape hatches, and add a completion gate.
4. Tie the countermeasure to the observed behavior, not to a hypothetical.
5. Note corroboration — how many independent observations demand it.

## See also

- `rule-research` → `rule-writing` → `rule-validate` — the pipeline for the rule column.
- `product-thinking` — whether a change earns a permanent place on the product surface.
- `writing-guidelines` — prose voice and tone for the guidance column.
