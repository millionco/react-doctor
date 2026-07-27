# Effect v4 conventions

Use this reference whenever code imports Effect. Root [AGENTS.md](../../AGENTS.md) makes these conventions binding.

The codebase uses `effect@4.0.0-beta.70`. The conventions below are binding. Optional local checkouts of Effect and `react-doctor-evals` can provide additional examples, but they are not required.

## Imports

- ALWAYS: use namespace imports such as `import * as Schema from "effect/Schema"` and `import * as Effect from "effect/Effect"`. Use one Effect module per import line
- NEVER: `import { Schema, Effect } from "effect"`. The umbrella import inflates the type-resolution graph and contradicts the established project convention.

## Errors

- Every fallible service uses `ReactDoctorError` as its typed failure channel
- Each reason is a `Schema.TaggedErrorClass<Self>()("Tag", { fields })` with a `get message()` getter that returns human-readable text
- Opaque causes use `Cause.pretty(Cause.fail(this.cause))` in the message body
- Renderers dispatch on `error.reason._tag`, NEVER on `error.message.includes(...)`
- `formatReactDoctorError`, `isReactDoctorError`, `isSplittableReactDoctorError`, and `restoreLegacyThrow` live in `packages/core/src/errors.ts`. Reuse them instead of adding another error-shape helper

## Error dispatch and recovery

- **`Effect.catchReasons(errorTag, cases, orElse?)`**: dispatch on a `Schema.TaggedErrorClass` reason union. Each entry catches one reason `_tag`; optional `orElse` handles unmatched reasons. NEVER write manual reason ladders inside a catch block. See `packages/core/src/errors.ts` and `packages/api/src/diagnose.ts`
- **`Effect.catchTag(tag, handler)`**: recover one tagged error, such as `Effect.catchTag("PlatformError", ...)`
- **`Effect.catch`**: use for catch-all recovery; it replaced v3 `Effect.catchAll`
- **`Effect.die(error)`**: promote a recovered value into a defect that `runPromise` re-throws unchanged. Use it in `catchReasons` handlers where the programmatic contract still requires the legacy `Error` class
- NEVER use `try/catch` inside `Effect.gen`. Wrap synchronous throws in `Effect.try({ try, catch })` and recover with `Effect.orElseSucceed` or `Effect.catch`. See `packages/react-doctor/src/cli/utils/render-summary.ts`

## Generator hygiene

- **`return yield* Effect.fail(...)`**: return terminal effects such as `Effect.fail`, `Effect.interrupt`, and `Effect.die` so TypeScript sees unreachable code
- **`Effect.gen({ self: this }, function* () { ... })`**: use the options object for a class-method generator bound to `this`. Plain `Effect.gen(function* () { ... })` remains valid
- **`Effect.fnUntraced(function* () { ... })`**: prefer it to a function whose body is `Effect.gen` only on a measured hot path

## Services

- `Context.Service<Self, Interface>()("react-doctor/Name", { make: ... })`: use the `react-doctor/X` prefix in the identifier
- Service method bodies use `Effect.fnUntraced` for hot paths and `Effect.sync` for one-liners. Test layers and orchestration use `Effect.gen`
- **`Effect.fn("Service.method")`**: name non-trivial service methods so tracing can identify them. See `packages/core/src/services/project.ts`
- Use `Service.of({ ... })` inside `Layer.succeed` and service constructors. Do not replace it with an assertion
- Use `Layer.effect` when a service has initialization work; use `Layer.succeed` when it is stateless
- Methods with more than one parameter take one object argument, such as `Files.readLines({ filePath, rootDirectory })`

## Layer naming

- `layerNode` for the production Node.js implementation
- `layerOf(value)` for a test layer that returns a pre-supplied value
- `layerInMemory(Map)` for filesystem-shaped services backed by an in-memory tree
- `layerCapture` for a test layer that records calls into a `Ref` exposed through a sibling `*Capture` service, such as `ReporterCapture` or `ProgressCapture`
- `layerNoop` for a production layer with void-return/discard semantics, such as Reporter or Progress. Analyzers such as Linter and DeadCode use `layerOf([])` instead
- `layerComposite(backends)` for the slot where a future second backend plugs in
- Implementation-specific names: `layerOxlint`, `layerHttp`, `layerNdjson(path)`, `layerOra(factory)`

## Schemas

- Use `Schema.Class<Self>("Name")({ fields })` for wire records
- Use `Schema.Literals(["a", "b"])` for literal unions and `Schema.Literal(1)` for one literal
- Use `Schema.NullOr(X)` for `X | null` and `Schema.optional(X)` for `X?`
- Use `Schema.brand("X")` through `.pipe()` for branded primitives
- Use schemas for wire types such as Diagnostic and JsonReport. Use interfaces for argument types such as InspectInput and LintInput to avoid hot-path runtime encode/decode cost

## Ambient configuration

- Route environment-variable reads and cache paths through `Context.Reference<T>("react-doctor/X", { defaultValue })`. See `packages/core/src/refs.ts`; tests override references with `Layer.succeed`
- Prefer `Config.redacted("ENV_NAME")` to `Context.Reference` for secrets such as API tokens and signing keys. Group several values with `Config.all({ ... })` at the service constructor. See `packages/core/src/observability.ts`

## Observability handoff

Use [observability](observability.md) for OTLP, Sentry, metrics, telemetry privacy, action attributes, and run IDs. It owns the complete operational policy. This reference owns the Effect APIs that instrument those paths.

## Console and logging

- ALWAYS import `* as Console` from `effect/Console` and use its effects in renderers, services, and Effect-typed code. Effect's `Console` is a `Context.Reference`, so tests and silent mode can replace it
- NEVER invent a parallel logger abstraction. `packages/react-doctor/src/cli/utils/cli-logger.ts` is the remaining synchronous bridge for imperative CLI helpers outside `Effect.gen`
- Silent mode uses `Effect.provideService(Console.Console, silentConsole)` in the renderer pipeline or `installSilentConsole()` in JSON mode. Both routes preserve `Console.*`; do not add `if (silent) return` checks at call sites
