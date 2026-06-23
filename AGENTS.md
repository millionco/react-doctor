## General Rules

- MUST: Use @antfu/ni. Use `ni` to install, `nr SCRIPT_NAME` to run. `nun` to uninstall.
- MUST: Use TypeScript interfaces over types.
- MUST: Keep all types in the global scope.
- MUST: Use arrow functions over function declarations
- MUST: Never comment unless absolutely necessary.
  - If the code is a hack (like a setTimeout or potentially confusing code), it must be prefixed with // HACK: reason for hack
- MUST: Use kebab-case for files
- MUST: Use descriptive names for variables (avoid shorthands, or 1-2 character names).
  - Example: for .map(), you can use `innerX` instead of `x`
  - Example: instead of `moved` use `didPositionChange`
- MUST: Frequently re-evaluate and refactor variable names to be more accurate and descriptive.
- MUST: Do not type cast ("as") unless absolutely necessary
- MUST: Remove unused code and don't repeat yourself.
- MUST: Use `truffler` to find existing symbols before adding a utility, helper, type, or rule, and again after finishing a task to catch duplicates and dead code (see "Symbol Search & Deduplication").
- MUST: Always search the codebase, think of many solutions, then implement the most _elegant_ solution.
- MUST: Before adding or changing the **public surface** (CLI flags/commands, the score, config, the JSON report, package APIs, the GitHub Action, website, or terminal output), run the `product-thinking` pass (`.agents/skills/product-thinking/`): name the user's job, reuse before adding, wire one telemetry metric, add the compatibility artifacts, and set a kill metric. Lint rules use the rule pipeline instead.
- MUST: Put all magic numbers in `constants.ts` using `SCREAMING_SNAKE_CASE` with unit suffixes (`_MS`, `_PX`).
- MUST: Put small, focused utility functions in `utils/` with one utility per file.
- MUST: Use Boolean over !!.

## Symbol Search & Deduplication (truffler)

`@rayhanadev/truffler` (dev dependency) is fuzzy JS/TS symbol search powered by `oxc-parser`.
Use it to avoid duplicating existing code. The `find-similar-functions` skill
(`.agents/skills/find-similar-functions/`) carries the full workflow; the short version:

- WHEN PLANNING / SCOPING — before adding a utility, helper, type, constant, or rule, search
  for an existing symbol to reuse or extend. Derive a few queries from the behavior (proposed
  name + domain noun + verb), search the narrowest root first, then read the top matches before
  writing anything. It is how you reuse an existing helper instead of duplicating it, per "don't
  repeat yourself" and the one-utility-per-file `utils/` convention.
- AFTER FINISHING A TASK — re-run searches for the symbols you added to confirm you did not
  duplicate an existing helper, and delete any code your change superseded.

```bash
bunx @rayhanadev/truffler "<query>" packages --kind function,method,interface,type,constant --limit 20
```

Run it with `bunx @rayhanadev/truffler` (the published `bin` is a TypeScript entry Bun runs
directly, and the pinned dev dependency is reused rather than re-downloaded). Narrow `<query>`
and the root (e.g. `packages/core/src`) for precision; broaden only when nothing matches.

## Package Layout

```
packages/
  core/                          PRIVATE  the diagnostic engine
    src/
      types/                     PRIVATE shared cross-package TS types (DiagnoseOptions,
                                 ProjectInfo, JsonReport, …) — no runtime code
      project-info/              project discovery (discoverProject, findMonorepoRoot,
                                 framework detection, narrow Error subclasses thrown
                                 BEFORE the Effect runtime takes over)
      errors.ts                  tagged Schema.TaggedErrorClass leaves + ReactDoctorError union
      schemas.ts                 Diagnostic / Severity / JsonReport / buildDiagnosticIdentity
                                 (also exposed as `@react-doctor/core/schemas` subpath
                                 since the names overlap the TS types above)
      refs.ts                    Context.Reference for ambient env config
      run-inspect.ts             streaming orchestrator (the heart)
      build-diagnostic-pipeline  per-element filter pipeline (single source of truth)
      services/                  10 Context.Service classes (Files, Git, Project,
                                 Config, Linter, DeadCode, Score, Reporter, Progress,
                                 NodeResolver, StagedFiles) + LintPartialFailures
      ...                        rest of the lint / score / suppression engine
  api/                           PRIVATE  programmatic diagnose() (Effect.runPromise shell)
  react-doctor/                  PUBLISHED  CLI + public inspect() + bin
  oxlint-plugin-react-doctor/    PUBLISHED  the 100+ rules, owns the canonical
                                 `react-native-dependency-names.ts` (re-exported from
                                 core to break the rule-package ↔ core cycle)
  eslint-plugin-react-doctor/    PUBLISHED  ESLint mirror of the oxlint plugin
  website/                       PRIVATE   docs site
```

## Effect v4 Conventions

Built on `effect@4.0.0-beta.70`. See `tmp/effect/.patterns/effect.md` (cloned reference)
and `~/Developer/react-doctor-evals/src/` (the application that pioneered these patterns
for this codebase) for canonical examples.

### Imports

- ALWAYS: `import * as Schema from "effect/Schema"`, `import * as Effect from "effect/Effect"`,
  `import * as Cause from "effect/Cause"`, etc. — one module per import line.
- NEVER: `import { Schema, Effect } from "effect"` — the umbrella import inflates the
  type-resolution graph and contradicts what every other Effect codebase does.

### Errors

- Every fallible service fails with `ReactDoctorError` (`reason: Schema.Union([...])`)
- Each leaf is a `Schema.TaggedErrorClass<Self>()("Tag", { fields })` with a
  `get message()` getter (NOT `message =`) returning a human string.
- Opaque causes use `Cause.pretty(Cause.fail(this.cause))` in the message body.
- Renderers dispatch on `error.reason._tag`, NEVER on `error.message.includes(...)`.
- `formatReactDoctorError(error)` / `isReactDoctorError(error)` / `isSplittableReactDoctorError(error)`
  live in `core/src/errors.ts`. Use them; don't add new error-shape helpers.

### Error dispatch / recovery — v4 idioms

- **`Effect.catchReasons(errorTag, cases, orElse?)`** — the v4-canonical way to
  dispatch on a `Schema.TaggedErrorClass` reason union. Each entry catches one
  reason `_tag`; the optional `orElse` handles unmatched reasons. NEVER write
  manual `if (cause.reason instanceof X)` ladders inside a `catch` block — the
  Effect pipeline gives you exhaustive, type-safe narrowing for free. See
  `inspect.ts → restoreLegacyThrow` and `api/diagnose.ts` for the canonical
  shape.
- **`Effect.catchTag(tag, handler)`** — for a single tagged error (e.g.
  `Effect.catchTag("PlatformError", ...)` in `services/git.ts` to fold the
  `ChildProcess` platform error into a `ReactDoctorError`).
- **`Effect.catch`** (renamed from v3 `Effect.catchAll`) — for catch-all.
- **`Effect.die(error)`** — promote a recovered value into a defect that
  `runPromise` re-throws unchanged. Used in `catchReasons` handlers when the
  programmatic contract still wants the legacy `Error` class on the throw.
- **NEVER** `try/catch` inside `Effect.gen` (v4 hard rule). Wrap the sync
  throw in `Effect.try({ try, catch })` and recover via
  `Effect.orElseSucceed` / `Effect.catch` instead. See
  `render-summary.ts → printSummary` for the canonical shape.

### Generator hygiene

- **`return yield* Effect.fail(...)`** — terminal effects (Effect.fail,
  Effect.interrupt, Effect.die) must be `return yield*` so TypeScript sees
  the unreachable-code property. Bare `yield*` of a terminal lets unreachable
  code accumulate after it. See `services/git.ts` `diffSelection` for examples.
- **`Effect.gen({ self: this }, function* () { ... })`** — v4 changed the
  `self`-bound form. The plain `Effect.gen(function* () { ... })` form is
  unchanged; only class-method generators bound to `this` need the options
  object.
- **`Effect.fnUntraced(function* () { ... })`** — prefer over a function
  whose body is `Effect.gen` when the function is called many times per
  operation (hot path). Cuts tracing overhead. Not currently used in this
  codebase — Git invocations and inspect-pipeline calls run once per scan,
  not in a hot loop.

### Services

- `Context.Service<Self, Interface>()("react-doctor/Name", { make: ... })` — short
  prefix in the identifier (matches react-doctor-evals' `rde/X` shape).
- Service method bodies use `Effect.fnUntraced` for hot paths, `Effect.sync` for
  one-liners. Test layers + orchestration use `Effect.gen`.
- **`Effect.fn("Service.method")`** for non-trivial methods so they surface as
  named spans in OTel traces. Production cost is zero when no tracer layer is
  provided; with `Otlp.layerJson(...)` users see one span per service call.
  Canonical eval pattern (`react-doctor-evals/src/Runner.ts` → every method).
- `Service.of({ ... })` everywhere inside `Layer.succeed` / `make:` — never
  `{ ... } as const`.
- `Layer.effect` when the service has init work (e.g. `Cache.make`); `Layer.succeed`
  when stateless.
- Method takes a single object arg when there are >1 parameters
  (e.g. `Files.readLines({ filePath, rootDirectory })`).

### Layer naming

- `layerNode` for the production Node.js implementation.
- `layerOf(value)` for the test layer that returns a pre-supplied value.
- `layerInMemory(Map)` for filesystem-shaped services backed by an in-memory tree.
- `layerCapture` for the test layer that records calls into a `Ref` exposed via a
  sibling `*Capture` service (e.g. `ReporterCapture`, `ProgressCapture`).
- `layerNoop` for the production layer that has void-return / discard semantics
  (Reporter, Progress). Analyzers (Linter, DeadCode) use `layerOf([])` instead.
- `layerComposite(backends)` for the slot a future second backend plugs into.
- Implementation-specific names: `layerOxlint`, `layerHttp`, `layerNdjson(path)`,
  `layerOra(factory)`.

### Schemas

- Use `Schema.Class<Self>("Name")({ fields })` for wire records.
- Use `Schema.Literals(["a", "b"])` for unions of literals (plural), `Schema.Literal(1)`
  for single literals.
- `Schema.NullOr(X)` for `X | null`; `Schema.optional(X)` for `X?`.
- `Schema.brand("X")` via `.pipe()` for branded primitives.
- Schema for wire types (Diagnostic, JsonReport); interfaces for arg types
  (InspectInput, LintInput) — avoid runtime encode/decode cost on hot paths.

### Ambient config

- Env-var reads + cache paths go through `Context.Reference<T>("react-doctor/X", { defaultValue })`.
  See `core/src/refs.ts`. Tests override via `Layer.succeed(MyRef, ...)`.
- Secrets (API tokens, signing keys) should prefer `Config.redacted("ENV_NAME")` over
  `Context.Reference` so they auto-redact in logs / traces. Group with `Config.all({ ... })`
  at the service constructor when you need several. (Pattern from
  `react-doctor-evals/src/GitHub.ts` — not yet used in this codebase; document
  the convention so the first secret-shaped config does it right.)

### Observability

- Wrap the top-level entry of a multi-step operation in `Effect.withSpan("name", { attributes })`.
  See `core/src/run-inspect.ts → runInspect` for the canonical shape. Attribute
  keys use dotted namespacing (`inspect.directory`, `inspect.isCi`).
- Per-service-method spans come from `Effect.fn("Service.method")` — see Services section
  above. The two compose: `runInspect` is the parent span, every `Service.method` is a child.
- Production observability layer is `layerOtlp` in `core/src/observability.ts`
  (wired into both `inspect()` and `diagnose()`). It's a no-op unless the user
  sets BOTH `REACT_DOCTOR_OTLP_ENDPOINT` (e.g. `https://api.axiom.co`) and
  `REACT_DOCTOR_OTLP_AUTH_HEADER` (e.g. `Bearer <token>`) in the environment.
  When both are set, it provides `Otlp.layerJson({...})` from
  `effect/unstable/observability/Otlp` with `NodeHttpClient.layerUndici` as the
  transport, so every `Effect.fn("Service.method")` span and every top-level
  `Effect.withSpan("...")` ships to the configured backend. Eval reference:
  `react-doctor-evals/src/Observability.ts → layerAxiom`.
- **Sentry tracing (CLI only).** The published CLI bridges the same Effect spans
  into Sentry. `cli/utils/apply-observability.ts` is the single chooser of the
  tracer backend (Effect has one `Tracer` reference, so they're mutually
  exclusive): user OTLP wins (and the Effect trace is parented under the Sentry
  trace via `Tracer.externalSpan` for a shared `trace_id`); otherwise, when
  Sentry performance tracing is live, `cli/utils/sentry-tracer.ts`
  (`makeSentryTracer`) materializes each Effect span as a child Sentry span
  under the per-run transaction (`cli/utils/with-sentry-run-span.ts`); otherwise
  the no-op native tracer. All of this is gated by `isSentryTracingEnabled()` so
  it's a true no-op for the `@react-doctor/api` library, `--no-score`, tests,
  and `SENTRY_TRACES_SAMPLE_RATE=0`. Source maps are uploaded for symbolication
  by `scripts/sentry-sourcemaps.mjs` (Debug IDs); the SDK `release`
  (`react-doctor@<version>`) must match what that script uploads.
- **Sentry scope shape.** `cli/utils/build-sentry-scope.ts` is the one place that
  projects the run snapshot (and the scanned project, once known) into Sentry
  `tags` + `contexts`; both `instrument.ts` (`initialScope`) and
  `report-error.ts` consume it, so add new metadata there, not at call sites.
  Project info is captured in the `beforeLint` hook via
  `recordSentryProjectContext` (`with-sentry-run-span.ts`), which both remembers
  it for the lazy error path (a module-level ref read by `buildSentryScope`,
  mirroring how `buildRunContext` reads ambient state at capture time) and sets
  it as root-span attributes for the live transaction.
- **Sentry anonymization.** Telemetry must stay anonymized. `Sentry.init` sets
  `sendDefaultPii: false`, and `beforeSend` + `beforeSendTransaction` both run
  `scrubSentryEvent` (`cli/utils/scrub-sentry-event.ts`): it strips
  hostname/`server_name`/device name and the IP-bearing `user`, drops captured
  stack-frame local variables, and runs every remaining string (messages,
  frames, contexts, extra, tags, breadcrumbs, and span attributes like
  `inspect.directory`) through `scrubSensitivePaths` (home dir / username →
  `~`, in `cli/utils/scrub-sensitive-text.ts`) + core's `redactSensitiveText`
  (secrets/emails). `buildRunContext` also scrubs `cwd`/`argv` at the source. If
  you add a new field to any Sentry event, confirm it carries no username,
  hostname, IP, secret, or absolute path — and prefer adding it through
  `buildSentryScope` so the central scrub covers it. `scrubSentryEvent` returns
  `null` on any failure so an un-anonymized event is never sent.
- **Crash references + trace linkage.** `reportErrorToSentry` returns the Sentry
  event id; the CLI catch blocks thread it into `handleError` so it's printed as
  a user-quotable reference and added to the prefilled GitHub issue. Errors
  thrown during a scan are linked to the run transaction by capturing them with
  the run's trace as the scope's propagation context — `withSentryRunSpan`
  records the live trace in `active-run-trace.ts` (cleared only on success, so
  the command catch — which runs after the span ends — can still read it), and
  `reportErrorToSentry` re-attaches via `scope.setPropagationContext`.
- **Sentry metrics (CLI only).** Anonymized Application Metrics (counters +
  distributions) are emitted through `cli/utils/record-metric.ts`
  (`recordCount` / `recordDistribution`), each guarded so it's a true no-op
  unless `Sentry.isInitialized()` — inert for `--no-score`, tests,
  and the `@react-doctor/api` library — and independent of `tracesSampleRate`
  (metrics flow even when tracing is off). Metric names live in the `METRIC` map
  in `cli/utils/constants.ts` (dotted, domain-grouped; high-cardinality
  dimensions go in attributes, never the name). The run snapshot — and, once a
  scan discovers it, the project shape — is merged onto **every metric at emit
  time** by `record-metric.ts`'s `withRunAttributes`, which reprojects
  `buildSentryScope().tags` per emit. This mirrors how events rebuild
  `buildSentryScope` lazily, so metrics track runtime state (`--json` mode, a
  workspace scan's project rolling over, the project clearing on
  `resetSentryRunState`) rather than a stale init-time snapshot, and the
  attributes pass through `beforeSendMetric` scrubbing like any other. Emit
  sites pass only metric-specific attributes; the project shape comes from
  `recordSentryProjectContext` → `getSentryProjectInfo()`. Per-scan metrics
  (`scan.*`, `rule.fired`, `lint.failed`, …) are
  emitted by `cli/utils/record-scan-metrics.ts`; `rule.fired` is one
  high-cardinality counter keyed by `rule`/`plugin`/`category`/`severity`
  attributes (never a metric-name-per-rule). Anonymization: `Sentry.init` sets
  `beforeSendMetric: scrubSentryMetric` (`cli/utils/scrub-sentry-metric.ts`),
  which drops the `server.address` hostname attribute (the SDK adds it to the
  metric _before_ the hook, so the strip lands) and scrubs paths/secrets from
  attribute values via the shared `cli/utils/anonymize-text.ts` (also used by
  `scrubSentryEvent`), returning `null` to drop on failure. Add new counters
  through `record-metric.ts` + the `METRIC` map, and confirm any new attribute
  carries no username, path, or secret.
- **Sentry canonical run wide event (CLI only).** The richest telemetry is one
  high-dimensionality "wide event" per scan, not a pile of narrow counters: the
  per-run root span (`withSentryRunSpan`) is enriched with the full outcome by
  `cli/utils/build-run-event.ts` (`recordRunEvent`, plus the pure, testable
  `buildRunEventAttributes`). `inspect.ts` calls it on the success path (after
  `recordScanMetrics`) and, via a `try/catch` around the span body, on the
  failure path — so the event lands with an `outcome.status` (`clean`/`ok`/
  `blocked`/`error`), `outcome.exitCode`, and `outcome.errorTag` taxonomy even
  when the scan throws. The run + project base context is already on the span
  (run tags from `withSentryRunSpan`, project shape from
  `recordSentryProjectContext`), so the event adds only what those don't — every
  attribute namespaced by concept via `withNamespace` (`cli/utils/with-namespace.ts`)
  so the keys tree up in Sentry's attribute browser: scan config (`scan.mode`,
  `scan.parallel`, `scan.workerCount`, `scan.rulesConfigured`/`scan.rulesDisabled`,
  `scan.ignoredTagCount`, `scan.hasCustomConfig`, … plus the `scan.fileCount`
  extent), the verdict (`outcome.wouldBlock`/`outcome.blocking`/`outcome.clean`/
  `outcome.skippedChecks`), findings (`diag.total`, `diag.errors`/`diag.warnings`,
  `diag.affectedFiles`, `diag.distinctRules`, `diag.topRule`, per-category
  `diag.category.*`), `score.value`/`score.label`/`score.available`, the
  `lint.*`/`deadCode.*`/`supplyChain.*` pass outcomes, `timing.*` durations, and
  the CI/PR specifics (`action.actorAssociation`, `action.runnerOs`, and the
  forwarded action knobs `action.comment`/`action.reviewComments`/
  `action.versionPin`). Typing matters for querying: numeric outcomes are numbers
  (so Sentry can do `p75(score.value)`), dimensions are strings/bools (so they
  filter/group); `null` is dropped via `toSpanAttributes` so absent signals never
  become `"null"`. Query it in Sentry's **Trace Explorer** and build **Dashboard
  widgets on the Spans dataset** (filter/group by any attribute) instead of
  pre-aggregating counters. Put new run-level dimensions on `build-run-context.ts`
  → `build-sentry-scope.ts` (now also the `eventName` + `viaAction` tags) so they
  ride every event and metric; put per-scan outcome dimensions on the wide event
  (wrapped in `withNamespace`), **not** new counters (we deliberately did not add
  `ci.*` counters — those dims are wide-event attributes; the `scan.completed`/
  `scan.duration`/`rule.fired` metric counters stay as the cheap,
  trace-sampling-independent floor alongside `cli.invoked`/`cli.error`). Score
  reachability is derivable (`!score.available && !lint.failed && !scan.noScore`) and
  score latency is the `Score.compute` child span's duration, so neither needs a
  dedicated field. CI detection + the official-action marker and forwarded
  inputs live in `cli/utils/is-ci-environment.ts`; `action.yml` sets the
  `REACT_DOCTOR_GITHUB_ACTION` marker + `REACT_DOCTOR_ACTION_*` env on its scan
  step. All attributes pass through `scrubSentryEvent`; keep them free of
  username, path, secret, and repo/owner identity.
- **runId.** `cli/utils/run-id.ts` mints one random `runId` per CLI run
  (process). It rides the Sentry `run` context (and thus the wide event) but is
  **never** a tag or metric attribute — a per-run unique value there would
  explode tag/counter cardinality. A workspace invocation scanning several
  projects shares one `runId`; the per-project span attributes disambiguate. Do
  not add a plaintext or hashed repo id to Sentry.

### Console / logging

- ALWAYS: `import * as Console from "effect/Console"` and `yield* Console.log(...)` /
  `Console.warn(...)` / `Console.error(...)` from inside renderers, services, and any
  Effect-typed code. Effect's `Console` is a `Context.Reference` whose default sink is
  `globalThis.console`, so the production path is identical to a raw `console.log`
  while remaining swappable for tests / silent mode.
- NEVER: invent a parallel `Logger` / `LoggerWriter` abstraction. The historical custom
  Logger service was removed when the renderer pipeline went Effect-typed; the only
  remaining bridge is `cli/utils/cli-logger.ts`, a thin sync wrapper around
  `Effect.runSync(Console.X)` for imperative CLI helpers that aren't yet `Effect.gen`.
- Silent mode is `Effect.provideService(Console.Console, silentConsole)` (renderer
  pipeline) or `installSilentConsole()` (JSON mode, which monkey-patches the global
  console because the surrounding CLI command body is imperative). Both routes leave
  the underlying `Console.*` Effect intact — there is no `if (silent) return` check
  at any call site.

## Testing

Tests live alongside source in each package's `tests/` directory:

- `packages/core/tests/` — service tests + run-inspect orchestration tests
- `packages/api/tests/` — api shell tests
- `packages/react-doctor/tests/` — CLI + end-to-end fixture tests

Test framework is `vite-plus/test` (the existing vitest wrapper).

Run checks always before committing with:

```bash
pnpm test         # all packages
pnpm lint
pnpm typecheck
pnpm format       # use `format:check` to verify only
pnpm smoke:json-report   # validates the built CLI's JSON output against the schema
```

## GitHub Action versioning

The composite GitHub Action is **versioned independently from the npm packages**. "The action"
is `action.yml` (repo root) plus the scripts it shells out to (`scripts/ensure-json-report.mjs`,
`scripts/render-github-action-comment.mjs`). Treat a change to any of those files as an action
release.

- Two tag namespaces coexist — never conflate them:
  - npm packages — `react-doctor@X.Y.Z`, `eslint-plugin-react-doctor@X.Y.Z`,
    `oxlint-plugin-react-doctor@X.Y.Z` (created by Changesets in CI; see
    `.github/workflows/publish.yml`).
  - GitHub Action — `v`-prefixed semver `vX.Y.Z` plus a floating major `vN` (the GitHub Actions
    convention; the `v` prefix keeps these distinct from the unprefixed package tags above).
    Current: latest is `v1.1.1`; `v1` → the same commit. The `v0.x` line is the pre-rebuild
    action; the `f4035fce` PR-reporting rebuild is `v1.0.0`.
- MUST: cut a tag on every commit that touches the action files. `feat(action)` → minor bump;
  everything else (`fix` / `refactor` / `chore` / `revert` / docs-only edits to `action.yml`) →
  patch bump. A breaking change to inputs/outputs or the runtime contract → major bump.
- MUST: after tagging a new `vX.Y.Z`, move the floating major `vN` to that same commit so
  `uses: millionco/react-doctor@vN` keeps resolving to the latest compatible release.
- Tags are GPG-signed annotated tags (`tag.gpgsign=true`), so a bare `git tag vX` will demand a
  message and fail in scripts. Always create/move with an explicit message:

```bash
# new release at the commit that changed the action
git tag -a v1.1.2 <commit> -m "react-doctor action v1.1.2"
# move the floating major (force-update only the vN pointer)
git tag -fa v1 <commit> -m "react-doctor action v1 (floating major -> v1.1.2)"
git push origin v1.1.2
git push --force origin v1   # the force applies to the moving major tag only
```

- MUST: never tell consumers to reference `@main` in docs/examples. `@main` runs whatever HEAD
  points to with `pull-requests: write` granted — a supply-chain risk (issue #299). Recommend a
  full commit-SHA pin with a trailing version comment for hardened CI
  (`uses: millionco/react-doctor@<sha> # v1.1.1`), or `@vN` for convenience.

## Reference reading

- `tmp/effect/.patterns/effect.md` — canonical Effect v4 idioms (cloned for reference,
  gitignored)
- `~/Developer/react-doctor-evals/src/` — sister application this codebase's runtime
  patterns are modeled on (Schemas.ts, Runner.ts, Worker.ts, errors.ts shapes)
