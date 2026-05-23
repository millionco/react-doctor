# Context

Domain glossary and conceptual map for react-doctor.

Two views of the same codebase:

1. **End-user view** — react-doctor is a CLI + npm package that scans a React project and prints diagnostics ("lint check failed in src/App.tsx:42" / "use `useEffect` here"), with a 0–100 score and a sharable URL. Optional: a GitHub Action that posts the same diagnostics inline on PRs.
2. **Architecture view** — an Effect v4 runtime that orchestrates 9 services (Project / Config / Files / Linter / DeadCode / Score / Reporter / Progress / Git) into a single streaming pipeline. The CLI and the programmatic `diagnose()` API are both thin shells around `runInspect`.

The end-user view is what the README and the website document. This file is the architecture view.

## Glossary

### Diagnostic

One finding from a scan. Shape: `{ filePath, line, column, rule, plugin, severity, message, help?, url?, category?, suppressionHint? }`. Located by point (line, column), not range.

Defined as a `Schema.Class<Diagnostic>("Diagnostic")(...)` in `packages/core/src/schemas.ts`. The schema is the source of truth — the JSON output (`--json`), the programmatic `diagnose()` return, and the inline-comment payload posted by the GitHub action all share this shape.

### InspectOutput

The structured result of one scan. Shape: `{ project, userConfig, resolvedDirectory, diagnostics, score, didLintFail, lintFailureReason, lintFailureReasonTag, lintPartialFailures, didDeadCodeFail, deadCodeFailureReason }`.

Returned by `runInspect` (the orchestrator). Consumed by the CLI's renderer, the programmatic `diagnose()`, and the GitHub action's `runDiagnoseAcrossWorkspace`.

### JsonReport

The wire format of `react-doctor --json`. Top-level `Schema.Union([JsonReportV1])` (versioned for forward-compat). Carries the same diagnostics plus a `summary` block, `projects[]` for monorepos, and a `diff` snapshot when `--diff`/`--staged` ran.

Round-trips through the schema with `Schema.encodeUnknownSync(JsonReport)` + `Schema.decodeUnknownSync(JsonReport)`. The smoke test (`scripts/smoke-json-report.ts`) validates every CI run.

### Service

A `Context.Service<Self, Shape>()("react-doctor/Name") {}` Effect v4 service. Used for every IO-shaped or environment-shaped dependency the orchestrator has: project discovery, config loading, file reads, lint backend, dead-code analysis, score API, reporter side-channel, progress spinner, git subprocess.

Two layers per service:

- `layerNode` — production implementation. Real IO.
- `layerOf(snapshot)` / `layerInMemory(map)` — test layer. Deterministic snapshot, no IO.

Some have additional variants: `Linter.layerComposite(backends[])`, `Linter.layerOxlint`, `Score.layerHttp`, `Reporter.layerNoop` / `layerCapture(ref)` / `layerNdjson(path)`.

### Layer stack

`layerInspectLive` in `run-inspect.ts` is the default production wiring. Callers override individual layers for `--offline` (swap `Score.layerHttp` → `Score.layerOf(null)`), `--no-lint` (`Linter.layerOxlint` → `Linter.layerOf([])`), etc.

### Per-element pipeline

The pure-function filter that runs over every diagnostic between the producer (Linter / DeadCode) and the renderer. Lives in `packages/core/src/build-diagnostic-pipeline.ts`. Applies in order:

1. **Auto-suppress** — drop diagnostics where the source file isn't actually a React component (e.g. flagged by oxlint but the file is a Node script).
2. **Severity controls** — apply `config.severityOverrides` so users can demote a rule to `warning` or upgrade to `error`.
3. **Ignore patterns** — apply `config.ignore.{paths, rules, tags}` so users can mute noisy diagnostics.
4. **Inline-disable** — honor `// eslint-disable-next-line` / `// oxlint-disable-next-line` comments in source.

Result is a `Filter.Filter<Diagnostic, Diagnostic>` over the stream. The filter is pure — no IO — because file reads it needs are batched through the `Files` service before the stream starts.

### Surface filter

`filterDiagnosticsForSurface(diagnostics, surface, config)` runs AFTER `runInspect` returns, per output consumer:

- `"cli"` — what the user sees in the terminal
- `"score"` — what counts toward the headline 0–100 (e.g. `design` cleanup rules demoted out of scoring by default)
- `"ciFailure"` — what triggers `process.exitCode = 1` under `--fail-on`

A single scan produces one diagnostic list; the surface filter picks the subset for each consumer.

### `inspect()` vs `diagnose()` vs `runInspect`

Three layers from outside in:

| Function                       | Package                        | Shape                                        | Caller                          |
| ------------------------------ | ------------------------------ | -------------------------------------------- | ------------------------------- |
| `inspect(directory, options)`  | `react-doctor`                 | `Promise<InspectResult>`                     | CLI commands                    |
| `diagnose(directory, options)` | `@react-doctor/api` (internal) | `Promise<DiagnoseResult>`                    | programmatic Node API consumers |
| `runInspect(input, hooks)`     | `@react-doctor/core`           | `Effect<InspectOutput, ReactDoctorError, …>` | both of the above               |

All three end up calling `runInspect` with `Effect.runPromise(Effect.provide(layerInspectLive))`. The differences are the legacy-error translation (`inspect.ts` and `api/diagnose.ts` use `Effect.catchReasons` to map tagged reasons back to legacy thrown classes) and the rendering / spinner integration that `inspect()` adds for CLI use.

### `ReactDoctorError` (tagged)

The single error type on the orchestrator's error channel. Defined as `Schema.TaggedErrorClass<ReactDoctorError>()("ReactDoctorError", { reason: Schema.Union([…]) })` in `packages/core/src/errors.ts`.

13 leaf reasons today: `OxlintUnavailable`, `OxlintBatchExceeded`, `OxlintSpawnFailed`, `OxlintOutputUnparseable`, `ConfigParseFailed`, `ProjectNotFound`, `NoReactDependency`, `AmbiguousProject`, `DeadCodeAnalysisFailed`, `GitInvocationFailed`, `GitBaseBranchMissing`, `GitBaseBranchInvalid`. Each leaf is itself a `Schema.TaggedErrorClass` with a `get message()` getter and (where applicable) a `cause: Schema.Unknown` for the underlying JS error.

Renderers dispatch on `error.reason._tag` via `Effect.catchReasons("ReactDoctorError", { TagA: …, TagB: … })`. NEVER on `error.message.includes(...)`.

### Legacy thrown errors (`@react-doctor/project-info`)

Pre-Effect-runtime errors that the public `inspect()` / `diagnose()` API still throws for back-compat: `NoReactDependencyError`, `ProjectNotFoundError`, `AmbiguousProjectError`, `PackageJsonNotFoundError`. Translation from the tagged reason happens at the outer boundary via `Effect.catchReasons(...)` → `Effect.die(new LegacyError(...))`.

### `Context.Reference` (ambient config)

Effect's mechanism for fiber-local config with a default. Used in `packages/core/src/refs.ts` for: `OxlintSpawnTimeoutMs` (env-var overridable), `OxlintOutputMaxBytes`, `StagedFilesTempDirPrefix`. Tests override via `Layer.succeed(MyRef, value)`.

### Branded paths

`OxlintBinaryPath` and `NodeBinaryPath` in `packages/core/src/paths.ts`. `Schema.String.pipe(Schema.brand("Tag"))` so a `string` can't be passed where a binary path is expected without explicit construction. Defensive against `"./not-actually-a-binary"` slipping into the spawn argument.

### Mode

Three scan modes the CLI exposes:

- `full` (default) — scan every source file under the project root.
- `--diff [<base>]` — only scan files changed vs the diff base (default: best-effort `origin/HEAD` → `main` → `master`). Goes through `Git.diffSelection`.
- `--staged` — only scan files staged for commit, materializing them into a temp tree first. Goes through `StagedFiles.materialize` (Zip-Slip defended).

Affects which files the linter sees (`includePaths`) and gates whole-project analyses like dead-code that don't make sense on a slice.

### Score

The headline 0–100 react-doctor number. Computed by POSTing the diagnostic set to the score API (`Score.layerHttp`) which returns `{ score, label }`. `--offline` / `--no-share` swaps to `Score.layerOf(null)` so no network call happens.

The score is computed AFTER `runInspect` returns with the surface filter applied (the `score` surface demotes weak-signal rule families like `design`), so the orchestrator's `Score` service runs with `layerOf(null)` from the CLI path. The programmatic `diagnose()` uses `Score.layerHttp` directly because its caller doesn't need surface filtering.

### Composite action (`actions/review/`)

The GitHub composite action lives in `actions/review/` (a separate workspace package, `@react-doctor/review-action`). On `pull_request` events it:

1. Materializes a base worktree at `pull_request.base.sha` in `RUNNER_TEMP`.
2. Runs `runDiagnoseAcrossWorkspace` against head + base.
3. Diffs the two snapshots by `(relativePath, rule, message)` identity → `{ newDiagnostics, fixedDiagnostics }`.
4. Posts a sticky summary comment + inline review comments on the `+` lines.
5. Resolves prior threads when their underlying diagnostic disappears.

`runDiagnoseAcrossWorkspace(scanDir, pathBaseDir)` takes both args so emitted `relativePath`s are repo-root-relative (the GitHub API key shape), even when `INPUT_DIRECTORY` scopes the scan to a subtree.

### Eval harness (separate repo)

`react-doctor-evals` (a sibling repo, NOT in this monorepo) runs react-doctor against a pinned corpus of OSS repos and:

- **Parity**: diff two react-doctor versions to gate refactor PRs.
- **Eval**: interactively score every diagnostic as TruePositive / FalsePositive / Skipped.
- **Digest**: rule-frequency / per-diagnostic JSON dump.

The architecture in this repo (Effect v4 services + tagged errors + streaming pipeline) is modeled on the eval's patterns. Cross-references between the two should go in commit messages, not in code.

## File map

```
packages/
  core/                          PRIVATE  the diagnostic engine
    src/
      run-inspect.ts             the streaming orchestrator (see .specs/inspect-pipeline.md)
      build-diagnostic-pipeline  per-element pure filter
      errors.ts                  tagged Schema.TaggedErrorClass leaves + ReactDoctorError union
      schemas.ts                 Diagnostic, Severity, JsonReport (wire types)
      refs.ts                    Context.Reference for ambient config
      paths.ts                   branded path types
      services/                  10 Context.Service classes — see Service section above
      ...                        rest of the lint / score / suppression engine
  api/                           PRIVATE  programmatic `diagnose()` (Effect.runPromise shell + legacy translation)
  project-info/                  PRIVATE  legacy React project discovery + legacy thrown error classes
  types/                         PRIVATE  shared cross-package type interfaces + RN dependency name constants
  react-doctor/                  PUBLISHED  CLI + public `inspect()` + bin
  oxlint-plugin-react-doctor/    PUBLISHED  the 100+ rules
  eslint-plugin-react-doctor/    PUBLISHED  ESLint mirror of the oxlint plugin
  website/                       PRIVATE  docs / leaderboard site

actions/
  review/                        PRIVATE  composite GitHub action (@react-doctor/review-action)

.specs/                          design specs (see inspect-pipeline.md)
CONTEXT.md                       this file — domain glossary
AGENTS.md                        coding conventions + Effect v4 rules
```

## Reference reading

- `.specs/inspect-pipeline.md` — design spec for the orchestrator.
- `AGENTS.md` — Effect v4 conventions enforced across the codebase.
- `~/Developer/react-doctor-evals/` — sister repo this codebase's runtime patterns are modeled on (`Schemas.ts`, `Runner.ts`, `WorkerPool.ts`, `errors.ts` shapes).
- `tmp/effect/.patterns/effect.md` — canonical Effect v4 idioms (cloned reference, gitignored).
- `tmp/effect/migration/*.md` — v3 → v4 migration guides (`error-handling.md`, `services.md`, `schema.md`, `yieldable.md`, etc.).
