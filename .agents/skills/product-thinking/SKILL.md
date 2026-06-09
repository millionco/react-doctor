---
name: product-thinking
description: Think like a product manager before changing React Doctor's public surface — CLI commands/flags, the 0–100 score, config (doctor.config.*), the JSON report schema, package APIs (inspect()/diagnose()), the GitHub Action, the website, and the canonical prompts. A step-by-step runbook for a user-facing change — locate the surface, search for a reuse candidate, wire one telemetry metric, add the compatibility artifacts (changeset / schemaVersion / action tag), update docs, and record a kill metric. Not for lint rules, which have their own pipeline. Also runs when the user types `/product-thinking`.
version: "1.0.0"
---

# Product Thinking

A runbook for changing anything a user interacts with. The agent defaults to building exactly what was asked; this pass adds the product checks it skips — whether the change earns its permanent place on the surface, and how you'll know it worked. Work the steps before you write code, fill in the brief as you go, and fold that brief into the PR. Use it to push back when a change isn't justified, not just to wave one through.

## When to run it

Run the pass whenever a diff touches a surface a user — a developer running React Doctor, or their CI — depends on. Every surface is a contract: once it ships, people build on it and you can't quietly take it back. Find where the surface lives first, so you edit the right place and can search it for something to reuse before adding.

| Surface                    | Where it lives                                                    | Why it's load-bearing                                                                                        |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| CLI command / flag         | `cli/index.ts`, `cli/commands/*.ts`, `cli/utils/inspect-flags.ts` | Every flag is forever — it has to be parsed, documented, tested, and kept working across releases.           |
| 0–100 score                | `core/src/calculate-score.ts`, `core/src/constants.ts`            | The number people screenshot and gate CI on; changing the math silently moves every user's score.            |
| Config option              | `core/src/types/config.ts`, `core/src/services/config.ts`         | A long-lived contract that interacts with existing precedence; a new knob is rarely removable later.         |
| JSON report field          | `core/src/schemas.ts`, `core/src/build-json-report.ts`            | A wire format other tools parse; a shape change breaks integrations unless `schemaVersion` is handled.       |
| Package API / exit code    | `react-doctor/src/inspect.ts`, `api/src/diagnose.ts`              | Programmatic consumers pin to it, so changes are semver-breaking and need a changeset.                       |
| GitHub Action input/output | `action.yml`                                                      | Versioned independently (`vN`); workflows in other repos break when an input or output changes.              |
| Terminal output / UX       | `cli/utils/` renderers                                            | The first impression and the daily experience; noise or confusion here is what makes people stop running it. |

**Not here:** lint rules go through the `rule-research` → `rule-writing` → `rule-validate` pipeline, and rule configuration through `doctor-explain` — this pass is for the surface _around_ the rules, not the rules themselves. Internal-only changes (the engine, private `core` types, tests, tooling) skip the pass entirely; note in one line why the change is internal and move on.

## Steps

```
- [ ] 1. Write the job + the change (2 lines)
- [ ] 2. Search for a reuse candidate; extend it or justify new surface
- [ ] 3. Wire exactly one metric
- [ ] 4. Pick the default + add the compatibility artifacts
- [ ] 5. Update docs
- [ ] 6. Record the kill metric
- [ ] 7. Run checks
```

### 1. Write the job and the change

Write two lines before anything else — they anchor every later step:

- **Job** — who runs React Doctor, what they are actually trying to get done, and what they do today instead (an existing flag or config option, a different tool, or nothing at all). Pin the job to behavior you've observed, not to what someone says they would hypothetically want.
- **Change** — the smallest surface that does that job. If the change is bigger than the job, you are building speculatively.

If you can't name a job the current surface can't already serve, stop — there is nothing to build, and the right move is to point the user at the existing way to do it.

Then run two filters before you commit to building:

- **Durability** — will this still matter as the model gets better at React (or the target framework)? Capabilities the model will absorb, or that are trivially commoditized, are not worth a permanent slot on the surface. Spend surface area on durable, deterministic value.
- **Trust** — a feature users don't trust is worse than no feature, because it teaches them to ignore the tool. If a change can fire false positives or can't back its recommendation with evidence, fix the trust problem first; shipping it "mostly right" erodes the whole product.

### 2. Search before adding

Reuse beats adding every time — the cheapest surface is the one you never create. Before adding a flag, option, or report field, search for an existing one to extend:

```bash
bunx @rayhanadev/truffler "<name or behavior>" packages --kind function,interface,type,constant --limit 20
rg -n "<flag-or-option-name>" packages/react-doctor/src/cli packages/core/src/types
```

Read the top matches before writing anything. Extend an existing surface when it does almost the same job — a new value on an existing flag, a new field on an existing config object, an extra column on output that's already there. Only add a brand-new surface when the job is genuinely distinct and no existing entry can carry it without becoming confusing. If you do add one, record in the brief what you searched for and why nothing fit, so the next person inherits the reasoning instead of re-litigating it.

### 3. Wire exactly one metric

You can't manage a surface you can't see, so a change isn't done until it emits a signal. Decide that signal _before_ you build — if you can't describe which number would move, you don't yet know what success means. CLI telemetry is anonymized Sentry and is already a no-op for the `@react-doctor/api` library, tests, and `--no-score`, so all you wire is the emit:

- **Adoption count** — is anyone using it? Add a name to the `METRIC` map in `cli/utils/constants.ts` and emit it via `cli/utils/record-metric.ts`. Use this for "did people turn this flag on".
- **Per-scan outcome** — what happened on this run? Add an attribute to the wide event in `cli/utils/build-run-event.ts` (a run-level dimension goes on `cli/utils/build-sentry-scope.ts`). Prefer one rich wide-event attribute over a pile of narrow counters — it stays queryable after the fact without new code.

Anonymization is non-negotiable: never put a username, path, secret, or repo identity in an attribute — everything must ride `scrubSentryEvent` / `scrubSentryMetric`. Then write the metric name and the threshold that would mean "this worked" into the brief.

North-star to judge against: the one durable metric is **CI cohort retention** — are teams still running React Doctor in CI weeks later? Treat most other numbers as vanity. For "is this loved rather than merely used," the proxy is a PMF survey scoring ≥40% "very disappointed" if it went away.

### 4. Pick the default and add the compatibility artifacts

The default is a product decision, not an implementation detail — most users never change it, so the default _is_ the behavior for almost everyone. Pick one that preserves today's behavior and make anything risky opt-in. Then ship the artifacts that keep existing users from breaking:

- **Published-package behavior changed** → add a changeset (`nr changeset`) so the change is versioned and lands in the changelog.
- **JSON report shape changed** → edit `core/src/schemas.ts`, preserve the existing shape or bump `schemaVersion`, and run `nr smoke:json-report`. CI pipelines parse this output, so an unannounced shape change breaks them silently.
- **Score weight or algorithm changed** → every user's number moves at once and CI gates keyed to a threshold can flip. Treat it as a breaking change: changeset plus an explicit call-out of the shift.
- **`action.yml` changed** → cut a `vX.Y.Z` tag and move the floating `vN`, because other repos pin to the major and won't receive the change otherwise.

### 5. Update the docs

A surface nobody can discover is wasted, and a stale doc is a trust bug. Documentation is part of "done," not a follow-up:

- The `--help` / usage text next to the new flag or command, so it's discoverable from the CLI itself.
- The website page and the canonical prompt under `react.doctor/prompts/...`, which is what agents fetch at runtime.
- The distributed skills (`skills/react-doctor`, `skills/doctor-explain`) when the change alters the user-facing workflow.

### 6. Record the kill metric

Surfaces accrete: every unused flag and dead config key is permanent maintenance and one more thing for users to misread. Decide up front how you'll know this one didn't earn its keep. Write one line in the brief — the metric from step 3, a threshold, and a horizon, e.g. "remove if `<metric>` stays under N after 2 releases". Schedule the check instead of trusting yourself to remember it, and treat deleting unused surface as a win, not an admission of failure.

### 7. Run checks

```bash
nr typecheck && nr test && nr lint
nr smoke:json-report   # only if you touched the JSON report
```

## Brief

Fill this in as you work the steps; fold it into the PR's "Why".

```md
## Product brief: <change>

Job: <who / goal / what they do today>
Change: <smallest surface that does it>
Reuse: <what you searched; what you extended, or why new surface was needed>
Metric: <METRIC name or wide-event attribute + the number that means success>
Compat: <default state; changeset / schemaVersion / action tag>
Kill: <metric threshold + horizon that triggers removal>
```

## Stop and ask when

These are the moments to surface a decision instead of pushing through — each one is a sign the change needs a human call:

- You can't name a job the current surface can't already do → propose reuse or dropping it rather than adding surface.
- You can't define a metric for it → either add the instrumentation or reconsider whether the change is real.
- It breaks a published contract (package behavior, JSON `schemaVersion`, the score, or action I/O) → confirm the changeset, version bump, and migration path before landing.
- It would grow scope beyond what was asked → get explicit agreement before expanding.

To land the change once the pass is clean, use `ship` (deslop, changeset, PR, babysit).

## Product principles (React Doctor)

Tie-breakers when a step is ambiguous — when two options both seem fine, pick the one these favor:

1. **Fewer findings > more findings.** Ten issues a developer will actually act on beat a hundred they scroll past; cap and rank rather than dump everything.
2. **Root causes > individual warnings.** Collapse the symptoms of one underlying problem into a single finding instead of reporting each echo separately.
3. **Evidence > assertions.** Show the proof — the code, the measurement, the reason — rather than asking the user to take the tool's word for it.
4. **Actionability > correctness.** A fixable issue with a clear next step beats a technically perfect finding nobody knows what to do with.
5. **Workflows > dashboards.** Meet developers where they already work — the CLI, PRs, the editor — instead of sending them to a separate surface.
6. **Education > diagnostics.** Explain _why_ something is a problem so the user learns, not just _that_ it is one.
7. **Trust > detection coverage.** The best finding is one the user believes and acts on; one false positive costs more trust than a missed issue costs coverage.
