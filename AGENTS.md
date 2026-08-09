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
```

## Effect v4 Conventions

Built on `effect@4.0.0-beta.102`. See `tmp/effect/.patterns/effect.md` (cloned reference)
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
- Implementation-specific names: `layerOxlint`, `layerHttp`, `layerOra(factory)`.

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

Telemetry is split across two backends, deliberately:

- **Axiom** takes traces and metrics — the per-run wide event, every
  `Effect.fn("Service.method")` span, and all counters/distributions. Axiom bills
  by ingested volume with no active-series limits, which is the model
  high-cardinality wide events want.
- **Sentry** takes crashes only. It keeps what it is good at: source-map
  symbolication (`scripts/sentry-sourcemaps.mjs`), issue grouping, and a
  quotable event id. Axiom has none of those.

Effect exposes a single `Tracer` reference, so the two are mutually exclusive
for spans: the CLI pins `tracesSampleRate: 0` and Sentry never records a span.

- Wrap the top-level entry of a multi-step operation in `Effect.withSpan("name", { attributes })`.
  See `core/src/run-inspect.ts → runInspect` for the canonical shape. Attribute
  keys use dotted namespacing (`inspect.directory`, `inspect.isCi`).
- Per-service-method spans come from `Effect.fn("Service.method")` — see Services section
  above. The two compose: `runInspect` is the parent span, every `Service.method` is a child.
- **Transport.** `core/src/observability.ts` owns three layers.
  `layerAxiomTraces` and `layerAxiomMetrics` are composed by hand rather than via
  `Otlp.layer`, because Axiom routes each signal to a different dataset through a
  different header (`X-Axiom-Dataset` vs `x-axiom-metrics-dataset`) and
  `Otlp.layer` passes one `headers` object to every signal. `layerObservability`
  merges them and picks the backend: a user-configured `REACT_DOCTOR_OTLP_*`
  endpoint wins over first-party Axiom, else Axiom, else `Layer.empty`.
  Serialization is **protobuf**, not JSON — Axiom's `/v1/metrics` accepts
  `application/x-protobuf` only. `OtlpSerialization.layerProtobuf` ships with
  Effect and adds no dependency.
- **Build the layer exactly once per process.** `cli/utils/telemetry-runtime.ts`
  builds it into a long-lived scope and shares the resulting `Context`; the run
  root span, the scan program, and the renderer all draw their tracer from it.
  Two reasons this is not optional. Child spans nest under the run span natively,
  with no `ExternalSpan` stitching. And Effect tracks delta-temporality state on
  the _metrics exporter instance_, so a second exporter starts with no previous
  snapshot and re-reports every counter's full value — silently doubling every
  metric. `shutdownTelemetry()` is memoized for the same reason: several exit
  paths can fire (a `--debug` user error flushes, then the top-level catch
  flushes again). A regression test in `core/tests/telemetry-payload.test.ts`
  pins the double-count behavior so a refactor that merges the layers fails loudly.
- **Exit flush.** Closing the telemetry scope is what ships buffered spans and
  metrics, bounded by `TELEMETRY_SHUTDOWN_TIMEOUT_MS` (1s — deliberately tighter
  than Sentry's 2s error flush). The periodic `TELEMETRY_EXPORT_INTERVAL_MS` is
  longer than any realistic run so the scope close is the only export. Note the
  metrics exporter passes `maxBatchSize: "disabled"` internally, which skips
  Effect's empty-buffer short-circuit — it POSTs on every scope close whether or
  not anything was recorded, so on a firewalled machine that request cannot fail
  fast. The language server overrides `exportIntervalMs` (see
  `LSP_TELEMETRY_EXPORT_INTERVAL_MS`) because an editor session may never shut
  down cleanly.
- **Anonymization.** Telemetry must stay anonymized, and OTLP has **no**
  `beforeSend`-style hook — the safety net Sentry gave us for free had to be
  rebuilt. Two mechanisms now carry it:
  - `core/src/utils/make-scrubbing-tracer.ts` wraps the tracer so every span
    name, attribute value, and event payload passes through `anonymizeText`
    (home dir / username → `~`, then secrets and emails redacted) on the way to
    the exporter. It is applied inside `layerAxiomTraces`, so an attribute added
    later cannot bypass it.
  - `cli/utils/record-metric.ts` scrubs attribute values at the emit site, since
    metrics never touch the tracer.

  Call sites should still scrub at the source — `run-inspect.ts` wraps
  `inspect.directory` in `scrubSensitivePaths` — and the tracer is the backstop
  for the ones that don't. `scrub-sentry-event.ts` still runs as Sentry's
  `beforeSend` for crash reports. If you add a field to any payload, confirm it
  carries no username, hostname, IP, secret, or absolute path.

- **Sentry scope shape.** `cli/utils/build-sentry-scope.ts` is the one place that
  projects the run snapshot (and the scanned project, once known) into `tags` +
  `contexts`. Both `instrument.ts` (`initialScope`) and `report-error.ts` consume
  it, and `record-metric.ts` reprojects its `tags` onto every metric at emit
  time — so add new run-level metadata there, not at call sites. Project info is
  captured via `recordSentryProjectContext` (`with-run-span.ts`), which both
  remembers it for the lazy error path and sets it as root-span attributes.
- **Crash references + trace linkage.** `reportErrorToSentry` returns the Sentry
  event id; the CLI catch blocks thread it into `handleError` so it's printed as
  a user-quotable reference and added to the prefilled GitHub issue. Because
  spans now live in Axiom, Sentry's native trace linkage no longer reaches them —
  instead the crash is tagged with `axiomTraceId` and `runId`, so a Sentry issue
  pivots straight into the run's Axiom trace. `--debug` prints that same trace id.
- **Metrics.** `cli/utils/record-metric.ts` (`recordCount` / `recordDistribution`)
  writes into Effect's process-global `MetricRegistry`, which the OTLP exporter
  snapshots at flush. Both are guarded by `isTelemetryEnabled()` so they are true
  no-ops under `--no-score` / `--no-telemetry`, in tests, and for the
  `@react-doctor/api` library. Metric names live in the `METRIC` map in
  `cli/utils/constants.ts` (dotted, domain-grouped; high-cardinality dimensions
  go in attributes, never the name). Two constraints differ from Sentry:
  Effect metric attributes are **string-only**, so numbers and booleans are
  stringified (`null`/`undefined` are dropped, never coerced to `"null"`); and
  histograms need explicit bucket boundaries, so all distributions share
  `METRIC_DISTRIBUTION_BOUNDARIES`. Per-scan metrics (`scan.*`, `rule.fired`,
  `lint.failed`, …) are emitted by `cli/utils/record-scan-metrics.ts`;
  `rule.fired` is one high-cardinality counter keyed by
  `rule`/`plugin`/`category`/`severity` attributes (never a metric-name-per-rule).
- **The canonical run wide event.** The richest telemetry is one
  high-dimensionality wide event per scan, not a pile of narrow counters: the
  per-run root span (`with-run-span.ts`) is enriched with the full outcome by
  `cli/utils/build-run-event.ts` (`recordRunEvent`, plus the pure, testable
  `buildRunEventAttributes`). `inspect.ts` calls it on the success path (after
  `recordScanMetrics`) and, via a `try/catch` around the span body, on the
  failure path — so the event lands with an `outcome.status` (`clean`/`ok`/
  `blocked`/`error`), `outcome.exitCode`, and `outcome.errorTag` taxonomy even
  when the scan throws. The run + project base context is already on the span, so
  the event adds only what that doesn't — every attribute namespaced by concept
  via `withNamespace` (`cli/utils/with-namespace.ts`) so the keys tree up in the
  attribute browser: scan config (`scan.mode`, `scan.parallel`, `scan.workerCount`,
  `scan.rulesConfigured`/`scan.rulesDisabled`, `scan.ignoredTagCount`,
  `scan.hasCustomConfig`, … plus the `scan.fileCount` extent), the verdict
  (`outcome.wouldBlock`/`outcome.blocking`/`outcome.clean`/`outcome.skippedChecks`),
  findings (`diag.total`, `diag.errors`/`diag.warnings`, `diag.affectedFiles`,
  `diag.distinctRules`, `diag.topRule`, per-category `diag.category.*`),
  `score.value`/`score.label`/`score.available`, the `lint.*`/`deadCode.*`/
  `supplyChain.*` pass outcomes, `timing.*` durations, and the CI/PR specifics
  (`action.actorAssociation`, `action.runnerOs`, and the forwarded action knobs
  `action.comment`/`action.reviewComments`/`action.versionPin`). Typing matters
  for querying: numeric outcomes are numbers (so you can take `p75(score.value)`),
  dimensions are strings/bools (so they filter/group); `null` is dropped via
  `toSpanAttributes` so absent signals never become `"null"`. Query it with APL
  over the traces dataset and build dashboards there instead of pre-aggregating
  counters. Put new run-level dimensions on `build-run-context.ts` →
  `build-sentry-scope.ts` so they ride every event and metric; put per-scan
  outcome dimensions on the wide event (wrapped in `withNamespace`), **not** new
  counters — the `scan.completed`/`scan.duration`/`rule.fired` counters stay as
  the cheap floor alongside `cli.invoked`/`cli.error`. Score reachability is
  derivable (`!score.available && !lint.failed && !deadCode.failed && !scan.noScore`)
  and score latency is the `Score.compute` child span's duration, so neither
  needs a dedicated field. CI detection + the official-action marker and
  forwarded inputs live in `cli/utils/is-ci-environment.ts`; `action.yml` sets the
  `REACT_DOCTOR_GITHUB_ACTION` marker + `REACT_DOCTOR_ACTION_*` env on its scan
  step. Keep every attribute free of username, path, secret, and repo/owner identity.
- **Opt-out.** `cli/utils/is-telemetry-enabled.ts` is the single gate for every
  backend: `--no-score`, `--no-telemetry`, `REACT_DOCTOR_NO_TELEMETRY`, or a test
  run disables all of it. Blanking `SENTRY_DSN` alone no longer silences
  anything, so internal tooling that must not report (the evals harness, the
  benchmark environment, the delta-audit runner) sets `REACT_DOCTOR_NO_TELEMETRY`.
- **Credentials.** The Axiom ingest token is embedded in `cli/utils/constants.ts`
  (`AXIOM_INGEST_TOKEN`), mirroring the public Sentry DSN — but unlike a DSN it is
  a real credential, so it is minted **ingest-only and scoped to the two
  datasets**. It ships in the tarball and is therefore extractable: rotation means
  cutting a release, and an Axiom monitor on anomalous ingest volume is the
  detection. `cli/utils/resolve-axiom-telemetry-options.ts` resolves it (with
  `REACT_DOCTOR_AXIOM_TOKEN` / `_DOMAIN` / `_DATASET` overrides for local
  testing — deliberately prefixed, since the bare `AXIOM_*` names are Axiom's
  own and reading them would hijack the telemetry of anyone already running it)
  and returns `null` when unset, so an unconfigured build simply doesn't export.
  Core never reads these itself — keeping them CLI-side is what makes
  `@react-doctor/api` silent by construction rather than by a runtime guard.
- **runId.** `cli/utils/run-id.ts` mints one random `runId` per CLI run
  (process). It rides the Sentry `run` context and the wide event, and is a tag
  only on crash reports (where it links to the Axiom trace) — never a metric
  attribute, where a per-run unique value would explode counter cardinality. A
  workspace invocation scanning several projects shares one `runId`; the
  per-project span attributes disambiguate. Do not add a plaintext or hashed repo
  id to either backend.

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

## Release authorization

- MUST: Discourage minor and major Changesets. Do not add one unless the user explicitly requests
  that release level. Patch Changesets may be added without a separate request when appropriate.
- MUST: Never merge a Changesets release PR, including any `changeset-release/*` branch, without
  fresh, explicit user confirmation for that exact PR and version immediately before the merge.
- General instructions to merge, ship, land, or babysit green PRs do not authorize merging a
  release/version PR. Treat merging a PR that triggers publication as publishing the release.
- MUST: Never publish packages, push or move release tags, or trigger, approve, rerun, or merge a
  release/publish workflow without fresh, explicit user confirmation for the exact versions and
  packages involved.
- Agents may prepare, validate, and babysit a release candidate, but must stop before the first
  publishing action and report the exact PR, versions, packages, tags, and workflows awaiting user
  approval.
- These confirmation requirements also apply to GitHub Action releases described below. Once the
  user explicitly approves a specific release, follow all required versioning and tag steps.

## GitHub Action versioning

The composite GitHub Action is **versioned independently from the npm packages**. "The action"
is `action.yml` (repo root) plus the scripts it shells out to (`scripts/ensure-json-report.mjs`,
`scripts/normalize-changed-files.mjs`, `scripts/render-github-action-comment.mjs`,
`scripts/resolve-package-spec.mjs`). Treat a change to any of those files as an action release,
and keep the list in sync with `ACTION_RELEASE_FILES` in
`scripts/recommend-action-version-bump.mjs` (the release guard).

- Two tag namespaces coexist — never conflate them:
  - npm packages — `react-doctor@X.Y.Z`, `eslint-plugin-react-doctor@X.Y.Z`,
    `oxlint-plugin-react-doctor@X.Y.Z` (created by Changesets in CI; see
    `.github/workflows/publish.yml`).
  - GitHub Action — `v`-prefixed semver `vX.Y.Z` plus a floating major `vN` (the GitHub Actions
    convention; the `v` prefix keeps these distinct from the unprefixed package tags above).
    Current: the `v2.x` line (check `git tag --list 'v*'` for the latest); `v2` → the same
    commit. The `v0.x` line is the pre-rebuild action; the `f4035fce` PR-reporting rebuild is
    `v1.0.0`.
- MUST: cut a tag on every commit that touches the action files. `feat(action)` → minor bump;
  everything else (`fix` / `refactor` / `chore` / `revert` / docs-only edits to `action.yml`) →
  patch bump. A breaking change to inputs/outputs or the runtime contract → major bump.
- MUST: after tagging a new `vX.Y.Z`, move the floating major `vN` to that same commit so
  `uses: millionco/react-doctor@vN` keeps resolving to the latest compatible release.
- Tags are GPG-signed annotated tags (`tag.gpgsign=true`), so a bare `git tag vX` will demand a
  message and fail in scripts. Always create/move with an explicit message:

```bash
# new release at the commit that changed the action
git tag -a v2.2.3 <commit> -m "react-doctor action v2.2.3"
# move the floating major (force-update only the vN pointer)
git tag -fa v2 <commit> -m "react-doctor action v2 (floating major -> v2.2.3)"
git push origin v2.2.3
git push --force origin v2   # the force applies to the moving major tag only
```

- MUST: never tell consumers to reference `@main` in docs/examples. `@main` runs whatever HEAD
  points to with `pull-requests: write` granted — a supply-chain risk (issue #299). Recommend a
  full commit-SHA pin with a trailing version comment for hardened CI
  (`uses: millionco/react-doctor@<sha> # v2.2.2`), or `@vN` for convenience.

## Reference reading

- `tmp/effect/.patterns/effect.md` — canonical Effect v4 idioms (cloned for reference,
  gitignored)
- `~/Developer/react-doctor-evals/src/` — sister application this codebase's runtime
  patterns are modeled on (Schemas.ts, Runner.ts, Worker.ts, errors.ts shapes)
