# react-doctor-lite (PoC)

A deliberately small re-imagining of the React Doctor engine that drops three
sources of accidental complexity from `@react-doctor/core`:

1. **oxlint subprocesses → in-process AST walking.** No temp `oxlintrc.json`, no
   `node <oxlint-bin> --format json`, no stdout parsing, no batched-spawn OOM
   dance. We parse with `oxc-parser` and run the existing
   `oxlint-plugin-react-doctor` rules directly.
2. **`ProjectInfo` boolean soup → a composable dependency graph.** Instead of
   `hasTanStackQuery` / `hasPreact` / `parseReactMajor` / `detectFramework` and
   friends, we walk the whole `package.json` graph (monorepo-aware) once and let
   everything query it: `graph.hasDependency("react", ">=19")`.
3. **Disk-only entry → first-class programmatic mode.** `diagnose()` accepts an
   in-memory dependency manifest and in-memory sources, so evals never have to
   inflate a fake `package.json` on disk.

> This is a proof of concept. It reuses the canonical rules and semantic
> analysis from `oxlint-plugin-react-doctor` verbatim — it only replaces the
> _runner_, the _project discovery_, and the _entry API_.

## Why it's faster

`@react-doctor/core` spawns oxlint in **sequential** batches (capped at ~100
files/batch to avoid OOM on large repos like `supabase/studio`). Sequential
batches leave most cores idle during the heaviest phase — JS-plugin rule
evaluation.

`react-doctor-lite` parses and lints in-process and distributes files across a
**worker-thread pool** with explicit `poolSize` / `batchSize` controls:

```ts
await diagnose({
  cwd: "/path/to/large/repo",
  concurrency: { poolSize: 8, batchSize: 32 },
});
```

Because there are no subprocesses, concurrency is a pool of threads instead of a
queue of `oxlint` processes, and the granularity is per-batch-of-files rather
than per-spawn.

## Usage

### Disk mode

```ts
import { diagnose } from "react-doctor-lite";

const result = await diagnose({ cwd: "/path/to/app" });
console.log(result.diagnostics, result.graph, result.capabilities);
```

### Programmatic / in-memory mode (no `package.json`, no files on disk)

This is the mode the auto-improving / eval workflows want:

```ts
import { diagnose } from "react-doctor-lite";

const result = await diagnose({
  dependencies: {
    dependencies: { react: "19.0.0", "@tanstack/react-query": "^5" },
    devDependencies: { typescript: "^5.6.0" },
  },
  sources: [{ filePath: "App.tsx", code: "/* ... */" }],
  rules: { only: ["no-array-index-as-key"] },
});
```

### The dependency graph directly

```ts
import { buildDependencyGraphFromDisk } from "react-doctor-lite";

const graph = buildDependencyGraphFromDisk(process.cwd());
graph.hasDependency("react", ">=19"); // boolean
graph.hasDependency("@tanstack/react-query@^5"); // combined specifier form
graph.getMajor("react"); // lowest installed major across the whole graph
graph.framework; // "nextjs" | "vite" | ... | "unknown"
```

## How it maps onto the existing pieces

| Concern | `@react-doctor/core` | `react-doctor-lite` |
| --- | --- | --- |
| Rule execution | oxlint subprocess + JSON stdout | `lintSource` — parse once, single tree walk dispatching every rule's visitors |
| Concurrency | sequential batched `oxlint` spawns | `worker-pool` over `worker_threads`, `poolSize`/`batchSize` knobs |
| Project discovery | `discover-project.ts` + a dozen boolean helpers | `build-dependency-graph.ts` → one queryable graph |
| Capability gating | `buildCapabilities(ProjectInfo)` | `buildCapabilities(DependencyGraph)` (same tokens, graph-sourced) |
| Rule metadata | `requires` / `disabledBy` / `tags` / `framework` | unchanged — reused from `oxlint-plugin-react-doctor` |
| Entry | `diagnose(directory)` (disk only) | `diagnose({ cwd? , sources?, dependencies? })` |

The capability tokens (`react:19`, `tanstack-query`, `tailwind:3.4`, …) are kept
identical so the existing rule `requires`/`disabledBy` metadata works without
changes — the only thing that changed is that the tokens are now _derived from
graph queries_ instead of bespoke `ProjectInfo` fields.

## Architecture

```
src/
  index.ts                      public diagnose() + graph/runner exports
  types.ts                      shared interfaces
  constants.ts                  worker-pool thresholds, ignored dirs, framework map
  dependency-graph/
    build-dependency-graph.ts   disk walk (monorepo root + workspaces) and in-memory build
    create-dependency-graph.ts  the queryable graph (hasDependency / getMajor / framework)
    find-monorepo-root.ts        ancestor climb to a workspace root
    read-workspace-globs.ts      pnpm-workspace.yaml + package.json#workspaces
    expand-workspace-glob.ts     prefix/* and prefix/** expansion
    derive-framework.ts
    read-package-json.ts
  capabilities/
    build-capabilities.ts       graph -> capability token set
  rules/
    load-rules.ts               capability-gated rule set (+ overrides) from the plugin
    should-enable-rule.ts       requires / disabledBy / tags / framework predicate
  runner/
    lint-source.ts              single-pass in-process lint of one source
    lint-sources-in-process.ts  loop over sources
    run-diagnostics.ts          orchestrator (in-process vs worker pool)
    worker-pool.ts              worker_threads pool with granular concurrency
    worker.ts                   worker entry
    read-source.ts
  utils/                        focused, one-per-file helpers
```

## Known PoC limitations

- The worker pool engages only in **built** (`.js`) mode — raw-TS worker threads
  cannot resolve the `.js`-style import specifiers, so source-mode runs and tiny
  inputs lint in-process. `pnpm build` then run, or rely on the in-process path.
- In-memory `sources` always lint in-process (workers read paths from disk).
- No inline `react-doctor-disable` suppression handling, no scoring, no dead-code
  pass, no config-file loading, no catalog (`catalog:`) version resolution, and
  glob negation/brace-expansion in workspace patterns are out of scope.
- A non-React project is not rejected (core throws `NoReactDependency`); lite
  simply enables the global rules.
```
