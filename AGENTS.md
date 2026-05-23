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
- MUST: Always search the codebase, think of many solutions, then implement the most _elegant_ solution.
- MUST: Put all magic numbers in `constants.ts` using `SCREAMING_SNAKE_CASE` with unit suffixes (`_MS`, `_PX`).
- MUST: Put small, focused utility functions in `utils/` with one utility per file.
- MUST: Use Boolean over !!.
- MUST: Never write changesets (`.changeset/*.md`) or edit `CHANGELOG.md`. Changesets and changelog entries are authored by humans at release time, not by agents.

## Package Layout

```
packages/
  core/                          PRIVATE  the diagnostic engine
    src/
      errors.ts                  tagged Schema.TaggedErrorClass leaves + ReactDoctorError union
      schemas.ts                 Diagnostic / Severity / JsonReport / buildDiagnosticIdentity
      refs.ts                    Context.Reference for ambient env config
      paths.ts                   Schema.brand for OxlintBinaryPath / NodeBinaryPath
      run-inspect.ts             streaming orchestrator (the heart)
      build-diagnostic-pipeline  per-element filter pipeline (single source of truth)
      services/                  10 Context.Service classes (Files, Git, Project,
                                 Config, Linter, DeadCode, Score, Reporter, Progress,
                                 NodeResolver, StagedFiles) + LintPartialFailures
      ...                        rest of the lint / score / suppression engine
  api/                           PRIVATE  programmatic diagnose() (Effect.runPromise shell)
  project-info/                  PRIVATE  legacy React project discovery (still separate
                                 from core to avoid a circular dep with oxlint-plugin
                                 over the shared isReactNativeDependencyName helper —
                                 see TODOS.md for the planned consolidation)
  types/                         PRIVATE  shared cross-package type interfaces +
                                 React Native dependency name constants
  react-doctor/                  PUBLISHED  CLI + public inspect() + bin
  oxlint-plugin-react-doctor/    PUBLISHED  the 100+ rules
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

### Services

- `Context.Service<Self, Interface>()("react-doctor/Name", { make: ... })` — short
  prefix in the identifier (matches react-doctor-evals' `rde/X` shape).
- Service method bodies use `Effect.fnUntraced` for hot paths, `Effect.sync` for
  one-liners. Test layers + orchestration use `Effect.gen`.
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

## Reference reading

- `tmp/effect/.patterns/effect.md` — canonical Effect v4 idioms (cloned for reference,
  gitignored)
- `~/Developer/react-doctor-evals/src/` — sister application this codebase's runtime
  patterns are modeled on (Schemas.ts, Runner.ts, Worker.ts, errors.ts shapes)
