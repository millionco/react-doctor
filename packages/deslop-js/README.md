# deslop-js

[![version](https://img.shields.io/npm/v/deslop-js?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/deslop-js)
[![downloads](https://img.shields.io/npm/dt/deslop-js.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/deslop-js)

Deslop JavaScript code.

Finds unused files, dead exports, dead dependencies, circular imports, redundant aliases, duplicate types, and other DRY violations. Each finding carries a confidence tier so you can gate CI on the high-signal ones and treat the rest as code-review prompts.

## Install

```bash
npm install deslop-js
```

## CLI

The `deslop-cli` package provides a command-line interface:

```bash
npm install -g deslop-cli
```

### Quick start

```bash
# scan the current directory
deslop

# scan a specific project
deslop ./my-project

# use the explicit analyze sub-command (equivalent to the above)
deslop analyze ./my-project
```

### Options

```bash
deslop [root] [options]

# custom entry points
deslop --entry src/main.ts --entry src/worker.ts

# ignore test files
deslop --ignore "**/*.test.ts" --ignore "**/__mocks__/**"

# only scan specific extensions
deslop --extensions .ts .tsx

# resolve path aliases via tsconfig
deslop --tsconfig ./tsconfig.json

# add explicit path aliases (in addition to the auto-detected ones)
deslop --paths "@app/*=src/*" --paths "@lib/*=packages/lib/*"

# include type-only exports in results
deslop --report-types

# report unused exports from entry files too
deslop --include-entry-exports

# output results as JSON (useful for CI or piping to other tools)
deslop --json

# exit with code 1 when unused code is found (for CI gates)
deslop --fail-on-issues

# exit with code 1 when circular imports are found
deslop --fail-on-cycles
```

### CI example

```bash
# fail the build if there are unused exports or circular imports
deslop ./src --fail-on-issues --fail-on-cycles --ignore "**/*.test.ts"
```

## Programmatic Usage

```ts
import { analyze, defineConfig } from "deslop-js";

const config = defineConfig({ rootDir: "./my-project" });
const result = await analyze(config);

// unused-code findings (syntactic)
result.unusedFiles; // files unreachable from any entry point
result.unusedExports; // exported symbols never imported
result.unusedDependencies; // package.json deps not imported anywhere
result.circularDependencies; // import cycles

// redundancy / DRY findings (syntactic, on by default)
result.redundantAliases; // `import { x as x }`, useless re-export renames
result.duplicateExports; // same name exported twice from one module
result.duplicateImports; // same specifier imported multiple times
result.redundantTypePatterns; // `T & {}`, `Partial<Partial<T>>`, etc.
result.identityWrappers; // `const wrap = (x) => fn(x)`
result.duplicateTypeDefinitions; // same-shape type declared in N files
result.duplicateInlineTypes; // anonymous `{ a, b, c }` repeated across modules
result.simplifiableFunctions; // `() => { return x }`, `await x; return x`
result.simplifiableExpressions; // `!!x`, `x ? x : y`, `cond ? true : false`
result.duplicateConstants; // same literal value across files
result.crossFileDuplicateExports; // same export name shipped by 2+ files that share an importer
result.reExportCycles; // `export * from "./a"` cycles (self-loop or multi-node)
result.privateTypeLeaks; // exported signature references a non-exported local type

// duplicate-block detection (token-based copy-paste; on by default, disable via `duplicateBlocks.enabled: false`)
result.duplicateBlocks; // suffix-array + LCP detected duplicate code blocks
result.duplicateBlockClusters; // clones grouped by file set + refactoring suggestions
result.shadowedDirectoryPairs; // directory pairs with many identical files

// feature flag inventory (on by default, disable via `featureFlags.enabled: false`)
result.featureFlags; // LaunchDarkly/Statsig/Unleash/PostHog/Vercel Flags/process.env.* uses

// function complexity hotspots (on by default, disable via `complexity.enabled: false`)
result.complexFunctions; // McCabe cyclomatic + SonarSource cognitive per function

// TypeScript-specific smells (on by default)
result.unnecessaryAssertions; // `x as unknown as T`, `x as any`, `x!!`, `<T>x`, `"foo"!`
result.lazyImportsAtTopLevel; // top-level `await import(...)` / `.then(...)` that should be static
result.commonjsInEsm; // `require()`, `module.exports`, `exports.x` inside ESM modules
result.typeScriptEscapeHatches; // `// @ts-ignore`, `// @ts-nocheck`, undocumented `@ts-expect-error`

// semantic findings (type-aware; on by default, disable via `semantic: { enabled: false }`)
result.unusedTypes; // type aliases / interfaces never referenced
result.unusedEnumMembers; // enum members no reference site uses
result.unusedClassMembers; // class members no caller invokes (skips React/Angular lifecycle methods)
result.misclassifiedDependencies; // `dependencies` entries used only as types

// diagnostics
result.analysisErrors; // structured errors from any pipeline stage
result.totalFiles;
result.totalExports;
result.analysisTimeMs;
```

## Programmatic Options

`defineConfig` accepts a required `rootDir` and optional overrides:

```ts
const config = defineConfig({
  rootDir: "./my-project",
  entryPatterns: ["src/main.ts"],
  ignorePatterns: ["**/*.test.ts"],
  tsConfigPath: "./tsconfig.json",
  reportTypes: true,
  includeEntryExports: true,
  reportRedundancy: true,
  semantic: { enabled: true },
});
```

| Option                | Type                                    | Default                                                          | Description                                                                                             |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `rootDir`             | `string`                                | required                                                         | Project root directory                                                                                  |
| `entryPatterns`       | `string[]`                              | auto-detected                                                    | Entry point glob patterns                                                                               |
| `ignorePatterns`      | `string[]`                              | `[]`                                                             | Glob patterns to exclude from analysis                                                                  |
| `includeExtensions`   | `string[]`                              | `[".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cjs", ".cts"]` | File extensions to scan                                                                                 |
| `tsConfigPath`        | `string \| undefined`                   | `undefined`                                                      | Path to tsconfig.json for path alias resolution                                                         |
| `paths`               | `Record<string, string[]> \| undefined` | `undefined`                                                      | Explicit path-alias mappings (e.g. `{ "@app/*": ["src/*"] }`), resolved alongside auto-detected aliases |
| `reportTypes`         | `boolean`                               | `false`                                                          | Include type-only exports in `unusedExports`                                                            |
| `includeEntryExports` | `boolean`                               | `false`                                                          | Report unused exports from entry files                                                                  |
| `reportRedundancy`    | `boolean`                               | `true`                                                           | Emit the redundancy / DRY findings listed above                                                         |
| `semantic`            | `SemanticConfig`                        | `undefined`                                                      | Opt-in TypeScript type-aware analysis (see below)                                                       |

Path aliases are auto-detected by default — from `tsconfig` `paths`, Vite (`resolve.alias`), webpack, Babel (`module-resolver`), and Jest (`moduleNameMapper`) configs, plus the workspace layout (a `@scope/<dir>` import resolves to the matching workspace package even when its `package.json` name differs). Use `paths` / `--paths` only for mappings none of those cover.

### Semantic (type-aware) analysis

On by default. Loads the TypeScript program when the project has a valid `tsconfig.json`; gracefully no-ops on JS-only projects. Disable with `semantic: { enabled: false }` to skip the ~1–3s program load.

```ts
const config = defineConfig({
  rootDir: "./my-project",
  semantic: {
    enabled: true,
    reportUnusedTypes: true,
    reportUnusedEnumMembers: true,
    reportUnusedClassMembers: false, // off by default, noisy on framework code
    reportMisclassifiedDependencies: true,
    reportRedundantVariableAliases: true,
    reportRoundTripAliases: true,
  },
});
```

| Option                            | Default     | Notes                                                                                                                                                          |
| --------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                         | `false`     | Master switch; semantic analysis loads the TS program and adds ~1–3s per scan                                                                                  |
| `reportUnusedTypes`               | `true`      | Type aliases / interfaces / type-only exports never referenced                                                                                                 |
| `reportUnusedEnumMembers`         | `true`      | Enum members no reference site reads or writes                                                                                                                 |
| `reportUnusedClassMembers`        | **`false`** | Subclass overrides, framework method-by-name invocation (`@HttpGet`, lifecycle hooks) produce too many stylistic FPs to enable by default. Opt in selectively. |
| `reportMisclassifiedDependencies` | `true`      | `dependencies` packages used only via `import type`                                                                                                            |
| `reportRedundantVariableAliases`  | `true`      | Local aliases like `const X = Y; export { X }`                                                                                                                 |
| `reportRoundTripAliases`          | `true`      | `import { X as Y } from "./a"; export { Y as X }`                                                                                                              |

### Duplicate blocks (token-based copy-paste detection)

On by default. Detects maximal duplicated token sequences across files via a suffix array + LCP pass over a normalized AST token stream. Tune thresholds or disable entirely:

```ts
const config = defineConfig({
  rootDir: "./my-project",
  duplicateBlocks: {
    enabled: true, // default
    mode: "semantic", // "strict" preserves identifiers/literals; "semantic" (default) blinds them
    minTokens: 50,
    minLines: 5,
    minOccurrences: 2,
    skipLocal: false, // true => only report cross-directory duplicates
  },
});
```

Surfaces in three result fields:

- `result.duplicateBlocks` — every duplicated block group with all its occurrences
- `result.duplicateBlockClusters` — duplicate blocks sharing the same file set, plus an `extract-function` / `extract-module` refactoring hint
- `result.shadowedDirectoryPairs` — directory pairs (e.g. `src/` and `deno/lib/`) whose files mirror each other

### Feature flag inventory

On by default. Scans the codebase for every place a feature flag is _read_ and produces a finding per use. The detector recognizes three families:

1. **Env-var flags** — `process.env.X` whose name starts with one of the built-in prefixes `FEATURE_`, `NEXT_PUBLIC_FEATURE_`, `REACT_APP_FEATURE_`, `VITE_FEATURE_`, `NUXT_PUBLIC_FEATURE_`, `ENABLE_`, `FF_`, `FLAG_`, `TOGGLE_` (extend with `extraEnvPrefixes`).
2. **SDK calls** with provider attribution — LaunchDarkly (`useFlag`/`variation`/...), Statsig (`useGate`/`checkGate`/...), Unleash (`isEnabled`/`getVariant`), GrowthBook (`isOn`/`isOff`/`getFeatureValue`), Split (`getTreatment`), PostHog (`useFeatureFlagEnabled`/...), ConfigCat, Flagsmith, Optimizely, Eppo, and Vercel Flags (`flag()` / `evaluate()` from `flags` or `@vercel/flags`).
3. **Config-object access** — `config.features.X` style; off by default because it's heuristic. Opt in with `detectConfigObjects: true`.

Each finding carries `name`, `path`, `line`, `column`, `sdkProvider` (when known), and `kind: "env-var" | "sdk-call" | "config-object"`. The detector also tracks the surrounding `if` / ternary guard span and sets `guardsDeadCode: true` when an `unusedExports` finding falls inside that guard — so a flag whose enabled branch contains only dead code lights up immediately.

**The actionable angle**: cross-reference `result.featureFlags` with your live flag dashboard.

- Flags in the dashboard but missing from `result.featureFlags` → no longer read by the codebase, safe to retire from the platform.
- Flags in `result.featureFlags` with `guardsDeadCode: true` → the guarded code is unreachable, delete both the flag and its body.

```ts
const config = defineConfig({
  rootDir: "./my-project",
  featureFlags: {
    enabled: true, // default
    extraEnvPrefixes: ["MYAPP_FF_"],
    extraSdkFunctionNames: ["myCustomFlag"],
    detectConfigObjects: false, // heuristic config.features.x — opt in if you use that pattern
  },
});
```

### Function complexity (cyclomatic + cognitive)

On by default. Reports per-function McCabe cyclomatic and SonarSource cognitive complexity, function size, and parameter count for every function that breaches at least one threshold. Tune the thresholds or disable entirely:

```ts
const config = defineConfig({
  rootDir: "./my-project",
  complexity: {
    enabled: true, // default
    cyclomaticThreshold: 10,
    cognitiveThreshold: 15,
    paramCountThreshold: 5,
    functionLineThreshold: 80,
  },
});
```

### TypeScript code smells

On by default. Four families of TypeScript-specific patterns surfaced at high or medium confidence — no extra config required.

```ts
result.unnecessaryAssertions; // type assertions that drop type-safety or do nothing
result.lazyImportsAtTopLevel; // dynamic imports at the module top level
result.commonjsInEsm; // CommonJS forms inside ESM modules
result.typeScriptEscapeHatches; // @ts-ignore / @ts-nocheck / undocumented @ts-expect-error
```

| Finding                          | Kinds                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result.unnecessaryAssertions`   | `redundant-double-assertion` (`x as unknown as T`), `assertion-to-any`, `redundant-non-null-on-literal` (`"foo"!`), `double-non-null` (`x!!`), `angle-bracket-assertion` (`<T>x`) |
| `result.lazyImportsAtTopLevel`   | `top-level-await-import`, `top-level-then-import`                                                                                                                                 |
| `result.commonjsInEsm`           | `require`, `module-exports`, `exports-assignment`                                                                                                                                 |
| `result.typeScriptEscapeHatches` | `ts-ignore`, `ts-nocheck`, `ts-expect-error-without-explanation`                                                                                                                  |

ESM detection follows the runtime rules: `.mts`/`.mjs` extensions are always ESM, `.cts`/`.cjs` are always CommonJS, and other files inherit from the nearest `package.json`'s `"type"` field.

## Findings have confidence tiers

Every redundancy / semantic finding carries `confidence: "high" | "medium" | "low"`. Use `"high"` for CI gates; `"medium"` and `"low"` are best treated as code-review prompts since intent is sometimes unknowable from syntax alone (e.g. `?? null` may be required by a typed callback signature).

## Error handling

`analyze()` never throws on a corrupted file, unparseable `tsconfig`, or missing dependency. Failures surface as `analysisErrors: DeslopError[]` with structured `code`, `module`, `severity`, and `path` fields. See `errors.ts` for the full taxonomy. Errors at `severity: "info"` (empty files, binary files, minified bundles skipped from redundancy analysis) are informational and do not indicate problems.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm format
```

## License

MIT
