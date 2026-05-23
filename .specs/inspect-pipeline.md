# Spec: `inspect()` pipeline

The streaming Effect orchestrator that turns "a directory on disk" into a structured `InspectOutput`. Owns the entire scan side of react-doctor; the CLI and the programmatic `diagnose()` API are both thin shells around it.

Lives in `packages/core/src/run-inspect.ts`. Wires 9 services (`Project`, `Config`, `Files`, `Linter`, `LintPartialFailures`, `DeadCode`, `Reporter`, `Score`, plus `Git` transitively via `StagedFiles` for the staged-mode façade) into a single `Stream<Diagnostic, ReactDoctorError>` and folds the result into `InspectOutput`.

## Design constraints

- **One Effect program**. No imperative `Promise.all` glue, no `async/await` inside the orchestration. The whole pipeline is a `Stream` so a future LSP host or watch-mode caller can swap `Stream.runCollect` for `Stream.runForEach(connection.sendDiagnostic)` without changing the orchestrator.
- **Failures are tagged, never thrown**. Lint / dead-code stream failures fold into a `Ref` via `Stream.catchTag("ReactDoctorError", ...)`. They do NOT sink the scan — the renderer reports them as `skippedChecks: ["lint"]` / `["dead-code"]` and the rest of the diagnostics still flow.
- **No "hidden" service dependencies**. Every service the orchestrator yields appears in the `Effect.Effect<…, ReactDoctorError, R>` requirement, so a caller that omits a Layer gets a compile error, not a runtime crash.
- **Per-element transforms are pure**. The auto-suppress / severity-override / ignore / inline-disable pipeline (`build-diagnostic-pipeline.ts`) is a single `Filter.fromPredicateOption` over each diagnostic. No state, no IO inside the filter — the file-reads it needs are batched through the `Files` service ahead of time.
- **Hooks vs services**. `InspectHooks` is for caller-side UI bookkeeping (CLI spinner lifecycle, project-detection block). Anything that needs to observe every diagnostic is a `Reporter` layer instead — that's the side-channel for future LSP / NDJSON / capture-for-test consumers.
- **Surface filtering happens outside**. `runInspect` returns ALL surviving diagnostics; the renderer applies `filterDiagnosticsForSurface("cli" | "score" | "ciFailure", …)` per output target. Keeps the orchestrator agnostic to who's consuming it.

## Service map

| Service               | Purpose                                                                                                          | Live layer                                                               | Test surface                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| `Project`             | Discover the React project at a directory (framework, react version, tailwind, etc.).                            | `layerNode` (wraps `@react-doctor/project-info`)                         | `layerOf(projectInfo)`                                 |
| `Config`              | Resolve `react-doctor.config.json` + `rootDir` redirect; cached.                                                 | `layerNode` (`Cache.make`-backed)                                        | `layerOf({ config, resolvedDirectory })`               |
| `Files`               | Read source-file lines + walk source files; abstracts `node:fs` for the per-element pipeline.                    | `layerNode`                                                              | `layerInMemory(Map<absolutePath, content>)`            |
| `Linter`              | Produces `Stream<Diagnostic, ReactDoctorError, LintPartialFailures>` from oxlint.                                | `layerOxlint` (wraps `runOxlint`)                                        | `layerOf(diagnostics[])`, `layerComposite(backends[])` |
| `LintPartialFailures` | `Ref<ReadonlyArray<string>>` for per-batch soft failures that surface to the renderer but don't fail the stream. | `layerLive`                                                              | n/a — service is just a `Ref` shape                    |
| `DeadCode`            | Whole-project reachability analysis.                                                                             | `layerNode` (wraps `checkDeadCode`)                                      | `layerOf(diagnostics[])`                               |
| `Reporter`            | Per-diagnostic side-channel (LSP push, NDJSON sink, capture for tests).                                          | `layerNoop` (production: scan returns the array via `Stream.runCollect`) | `layerCapture(ref)`, `layerNdjson(path)`               |
| `Score`               | Compute the headline 0–100 score from a diagnostic list.                                                         | `layerHttp` (POSTs to the score API)                                     | `layerOf(scoreResult \| null)`                         |
| `Git` (transitive)    | DI seam for every `spawnSync("git", ...)` call in the codebase. Used by `StagedFiles` + diff/staged façades.     | `layerNode` (uses Effect `ChildProcess` via `@effect/platform-node`)     | `layerOf({ stagedFiles, diffSelection, … })`           |

## Module map

```
packages/core/src/
  run-inspect.ts             # the orchestrator (this spec)
  build-diagnostic-pipeline  # per-element filter (auto-suppress / severity / ignore / inline-disable)
  errors.ts                  # 12 Schema.TaggedErrorClass leaves + ReactDoctorError union
  schemas.ts                 # Diagnostic, Severity, JsonReport (Schema.Class wire types)
  refs.ts                    # Context.Reference for ambient env / cache config
  paths.ts                   # branded OxlintBinaryPath / NodeBinaryPath
  services/
    config.ts                # Cache.make-backed config resolver
    dead-code.ts             # checkDeadCode wrapper as a Stream
    files.ts                 # readLines / listSourceFiles / isFile / isDirectory
    git.ts                   # Effect ChildProcess wrapper (spawnSync replaced PR 14)
    linter.ts                # runOxlint wrapper + LintPartialFailures companion Ref
    node-resolver.ts         # nvm / Node-version compatibility for the oxlint binding
    progress.ts              # spinner / progress reporter (ora-backed in CLI)
    project.ts               # @react-doctor/project-info wrapper
    reporter.ts              # per-diagnostic side-channel
    score.ts                 # score API client (HTTP)
    staged-files.ts          # materialize git-staged files into temp tree
```

## Pipeline (Stream-shape)

```
Stream.fromIterable(checkReducedMotion env diagnostics)
  ├─ Stream.concat(rawLintStream)
  │   └─ rawLintStream = linterService.run({...}).pipe(
  │        Stream.catchTag("ReactDoctorError", (e) => Stream.unwrap(
  │          Ref.set(lintFailure, {didFail: true, reason: e.message, reasonTag: e.reason._tag})
  │            .pipe(Effect.as(Stream.empty))
  │        ))
  │      )
  ├─ Stream.concat(deadCodeStream)        // gated on `runDeadCode && !isDiffMode`, same catchTag shape
  ├─ Stream.filterMap(perElementPipeline.apply)  // Filter.fromPredicateOption — pure, no IO
  └─ Stream.tap(reporterService.emit)      // side-channel (noop in prod, NDJSON in eval, push in LSP)

const survivingDiagnostics = yield* Stream.runCollect(transformedStream)
yield* reporterService.finalize

const score = lintFailureState.didFail
  ? null                                    // skip the score API when lint didn't run
  : yield* scoreService.compute({ diagnostics: surviving, isCi })
```

## Failure folding (the only place `catchTag` lives)

Two Refs hold the soft-failure state on the orchestrator side:

```ts
const lintFailure = yield* Ref.make<{
  didFail: boolean
  reason: string | null
  reasonTag: ReactDoctorErrorReason["_tag"] | null   // for renderer dispatch
}>({ didFail: false, reason: null, reasonTag: null })

const deadCodeFailure = yield* Ref.make<{ didFail: boolean; reason: string | null }>(...)
```

`Stream.catchTag("ReactDoctorError", ...)` on each producer drains the failure into the Ref and substitutes `Stream.empty`. The orchestrator continues; downstream `runCollect` sees only successful diagnostics.

The `reasonTag` field lets renderers dispatch on `OxlintUnavailable.kind === "native-binding-missing"` (→ "upgrade Node" hint) vs the generic case without string-sniffing on `message`. See `inspect.ts → restoreLegacyThrow` for the parallel `Effect.catchReasons` pattern at the outer boundary.

## Layers — production vs override

`layerInspectLive` (default for CLI + `@react-doctor/api`'s `diagnose()`):

```ts
Layer.mergeAll(
  Project.layerNode,
  Config.layerNode,
  DeadCode.layerNode,
  Files.layerNode,
  Linter.layerOxlint,
  LintPartialFailures.layerLive,
  Reporter.layerNoop,
  Score.layerHttp,
);
```

Common overrides:

- `--offline` → swap `Score.layerHttp` for `Score.layerOf(null)`
- `--no-lint` → swap `Linter.layerOxlint` for `Linter.layerOf([])`
- `--no-dead-code` → swap `DeadCode.layerNode` for `DeadCode.layerOf([])`
- programmatic caller with pre-loaded config → swap `Config.layerNode` for `Config.layerOf({ config, resolvedDirectory })`
- LSP / watch-mode → swap `Reporter.layerNoop` for `Reporter.layerCapture(ref)` and consume via `Stream.runForEach` instead of `Stream.runCollect` (requires changing the orchestrator)

## InspectInput / InspectOutput

```ts
interface InspectInput {
  readonly directory: string;
  readonly includePaths: ReadonlyArray<string>; // empty = full scan; non-empty = diff/staged
  readonly customRulesOnly: boolean; // skip builtin react/jsx-a11y rules
  readonly respectInlineDisables: boolean; // honor `// eslint-disable*` / `// oxlint-disable*`
  readonly adoptExistingLintConfig: boolean; // extend user's oxlint.json / .oxlintrc.json
  readonly ignoredTags: ReadonlySet<string>; // suppress diagnostics with `meta.tags` ∩ ignoredTags
  readonly nodeBinaryPath?: string; // override the Node binary used to spawn oxlint
  readonly runDeadCode: boolean; // also gated on `!isDiffMode`
  readonly isCi: boolean; // marks the run for the Score API
}

interface InspectOutput {
  readonly project: ProjectInfo;
  readonly userConfig: ReactDoctorConfig | null;
  readonly resolvedDirectory: string; // may differ from input.directory after `rootDir` redirect
  readonly diagnostics: ReadonlyArray<Diagnostic>; // surviving (= not auto-suppressed / inline-disabled / etc.)
  readonly score: ScoreResult | null; // null when lint failed or `--offline`
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  readonly lintFailureReasonTag: ReactDoctorErrorReason["_tag"] | null; // renderer dispatch
  readonly lintPartialFailures: ReadonlyArray<string>; // per-batch soft failures (e.g. one batch timed out)
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
}
```

## InspectHooks (caller participation, NOT services)

Hooks are for caller-side UI bookkeeping (spinner lifecycle, project-detection block). Anything observation-shaped should be a `Reporter` layer.

```ts
interface InspectHooks<HooksR = never> {
  readonly beforeLint?: (
    project: ProjectInfo,
    lintIncludePaths: ReadonlyArray<string> | undefined,
  ) => Effect.Effect<void, never, HooksR>;
  readonly afterLint?: (didFail: boolean) => Effect.Effect<void, never, HooksR>;
}
```

The CLI uses these to print "Detecting framework. Found React." spinner-checklist and to swap the lint spinner to ✓ / ✗ after the stream drains. Tests pass `NO_HOOKS = { beforeLint: Effect.void, afterLint: Effect.void }` (the default).

## Concurrency / interruption

- The pipeline is a single `Stream`, so `Effect.interrupt` propagating from the outer scope (e.g. SIGINT in the CLI) drops the in-flight oxlint spawn via `Effect.scoped` → `ChildProcess.spawn`'s scope finalizer.
- `Linter.layerOxlint` collects per-batch partial failures into a closure-captured array and drains them into the `LintPartialFailures` Ref AFTER the oxlint Promise resolves — no `Effect.runSync` bridge inside the callback (was a HACK pre-PR 12).
- `DeadCode.layerNode` wraps the legacy `checkDeadCode` Promise via `Effect.tryPromise`. Failures stream-catchTag into the `deadCodeFailure` Ref.
- The pipeline runs sequentially across the three producers (env → lint → dead-code) by design — diagnostics surface in deterministic order for the renderer's sort. A future parallel-producer mode is `Stream.merge` instead of `Stream.concat`, no other changes.

## Error model

- Inside `runInspect`: every fallible service raises a `ReactDoctorError` (tagged, `reason: Schema.Union([…])`). `ReactDoctorError` is the only error type on the orchestrator's error channel.
- At the public boundary: `inspect()` / `diagnose()` wrap `runInspect` with `Effect.catchReasons("ReactDoctorError", { NoReactDependency: …, ProjectNotFound: …, AmbiguousProject: …, orElse: e => Effect.die(new Error(e.message)) })` to preserve the legacy thrown-class contract for back-compat.
- Inside per-batch lint failures: `runOxlint`'s `onPartialFailure` callback receives reason strings; the Linter layer accumulates them into `LintPartialFailures` (a `Ref<readonly string[]>`). The renderer reports them via `skippedCheckReasons["lint:partial"]`.

## Surface filter (`filterDiagnosticsForSurface`)

`runInspect` returns ALL surviving diagnostics. The renderer applies the surface filter PER consumer:

- `"cli"` — what the user sees in the terminal output
- `"score"` — what counts toward the headline 0–100 (e.g. design rules are demoted out of scoring by default)
- `"ciFailure"` — what triggers `process.exitCode = 1` under `--fail-on`

This means `score` is computed in `inspect.ts` AFTER `runInspect` returns, with the surface filter applied:

```ts
const scoreDiagnostics = filterDiagnosticsForSurface([...output.diagnostics], "score", userConfig);
const score = didLintFail || offline ? null : await calculateScore([...scoreDiagnostics], { isCi });
```

The orchestrator's `Score` service runs with `layerOf(null)` from the CLI's `inspect.ts` and computes the score afterwards via `calculateScore` — the programmatic API (`@react-doctor/api`) uses `Score.layerHttp` directly because its caller doesn't need surface filtering. Both paths converge on the same score result for the same input.

## Test strategy

- Service-level: each service has a `layerOf(...)` (`layerInMemory` for `Files`) test layer in `packages/core/tests/services/*.test.ts`. The test layer takes a deterministic snapshot — no IO.
- Orchestrator-level: `packages/core/tests/run-inspect.test.ts` provides every service via its test layer and asserts the `InspectOutput` shape for representative scenarios (lint-only diagnostics, lint failure + dead-code, dead-code-disabled, etc.).
- End-to-end: `packages/react-doctor/tests/regressions/*.test.ts` exercise the CLI through `inspect()` with fixture directories.

## Adding a new diagnostic source

1. Make it a `Stream<Diagnostic, ReactDoctorError>`. If it's whole-project, mirror `DeadCode`; if it's per-file with batching, mirror `Linter`.
2. Wrap behind a `Context.Service<Self, { run: (input) => Stream<…> }>()("react-doctor/Name")`.
3. Add `Stream.concat(newSourceStream)` to the orchestrator after the existing `deadCodeStream`. Add a soft-failure `Ref` + `Stream.catchTag` if it can fail without sinking the scan.
4. Expose `layerNode` + `layerOf([])` for tests.
5. Add to `layerInspectLive`.

No changes to `build-diagnostic-pipeline.ts` — the per-element transforms apply uniformly to every diagnostic regardless of source. No changes to renderers — they read `InspectOutput.diagnostics` and don't care which producer surfaced what.

## Adding a new lint backend

Mirror the `Linter` service. The orchestrator binds to `Linter` (singular), so the runtime picks one backend via `Linter.layerOxlint` / a future `Linter.layerEslintWorker` / `Linter.layerComposite([…])`. The composite layer is already in place (`Linter.layerComposite(backends)`) — a second backend is one new `Layer` that satisfies the interface, plus the composite arg.

## Locked-in decisions

1. **Streaming, not array passing**. Even though production calls `Stream.runCollect` at the end, every intermediate transform stays in `Stream` so LSP / watch mode is one swap away.
2. **Failures via `Ref` + `catchTag`, not thrown**. The renderer needs the failure state alongside the surviving diagnostics; throwing would force `try/catch` around `runInspect` and lose the partial output.
3. **Per-element pipeline is pure**. Every transform that needs file IO batches through the `Files` service before the stream starts. The filter itself never touches disk.
4. **Reporter is a side-channel, not a sink**. Production uses `layerNoop` and reads the diagnostic array from `Stream.runCollect`. NDJSON / LSP / capture-for-test consumers swap the layer; the orchestrator's shape doesn't change.
5. **Hooks are NOT services**. `InspectHooks` is the caller-side participation point for spinner / progress UI. Diagnostic observation is a Reporter layer instead.

## Open follow-ups

- **Surface-filter inside the orchestrator?** Currently the renderer applies `filterDiagnosticsForSurface` AFTER `runInspect`. Could push it inside as a `Stream.filter` so the Reporter side-channel sees the surface-correct set. Blocked on the score computation needing the unfiltered set to compute the headline 0–100; either the score moves out or we run `runInspect` twice with different surface filters.
- **Per-file streaming for `DeadCode`**. Today `DeadCode.layerNode` returns the whole reachability analysis as one chunk. Converting to per-component streaming would let large monorepos surface dead components incrementally.
- **`Effect.fn("name")` on every service method**. Adds OpenTelemetry-compatible span names with zero behavioral change. The eval (`react-doctor-evals`) does this consistently; we don't yet. A future observability PR can layer in `Otlp.layerJson` from `effect/unstable/observability/Otlp` for Axiom / Honeycomb / OTel-collector export.
