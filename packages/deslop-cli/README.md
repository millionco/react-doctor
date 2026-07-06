# deslop-cli

Deslop JavaScript code.

CLI for [deslop-js](https://github.com/millionco/react-doctor/tree/main/packages/deslop-js). Finds unused files, dead exports, dead dependencies, circular imports, redundant aliases, duplicate types, and other DRY violations.

## Install

```bash
npm install -g deslop-cli
```

Requires Node.js 22 or later.

## Usage

Pass an explicit project root when possible (especially in monorepos):

```bash
deslop ./my-app
deslop analyze ./my-app
```

Analyze the current directory:

```bash
deslop
```

Output JSON for programmatic consumption:

```bash
deslop ./my-app --json
```

Fail CI when dead-code, redundancy, or code-quality findings are found (not circular imports):

```bash
deslop ./my-app --fail-on-issues
```

Fail CI when circular imports are found:

```bash
deslop ./my-app --fail-on-cycles
```

## What `deslop` reports

The default scan emits the following finding categories (each grouped in human output, fully detailed in `--json`):

| Category                   | What it catches                                                               |
| -------------------------- | ----------------------------------------------------------------------------- |
| `unusedFiles`              | Files unreachable from any entry point                                        |
| `unusedExports`            | Exported symbols never imported anywhere                                      |
| `unusedDependencies`       | `package.json` deps not imported                                              |
| `circularDependencies`     | Import cycles                                                                 |
| `redundantAliases`         | `import { x as x }`, useless re-export renames                                |
| `duplicateExports`         | Same name exported twice from one module                                      |
| `duplicateImports`         | Same specifier imported on multiple lines (merge them)                        |
| `redundantTypePatterns`    | `T & {}`, `Partial<Partial<T>>`, `Pick<T, keyof T>`, empty `extends`          |
| `identityWrappers`         | `const wrap = (x) => fn(x)`, calls without transforming                       |
| `duplicateTypeDefinitions` | Same structural type declared in multiple files                               |
| `duplicateInlineTypes`     | Anonymous `{ a, b, c }` shapes repeated across modules                        |
| `simplifiableFunctions`    | `(x) => { return f(x) }`, `await x; return x;`, useless `async`               |
| `simplifiableExpressions`  | `!!x`, `x ? x : y`, `cond ? true : false`, `x !== null && x !== undefined`    |
| `duplicateConstants`       | Same literal value used in N files under different names                      |
| `crossFileDuplicateExports`| Same export name repeated across files                                        |
| `duplicateBlocks`          | Copy-pasted code blocks                                                       |
| `duplicateBlockClusters`   | Related duplicated block groups across files                                  |
| `shadowedDirectoryPairs`   | Directories with overlapping file trees                                       |
| `reExportCycles`           | Re-export chains that point back to themselves                                |
| `featureFlags`             | Feature-flag branches that may guard stale code                               |
| `complexFunctions`         | Functions over complexity, parameter, or line-count thresholds                |
| `privateTypeLeaks`         | Public exports that expose private/internal types                             |
| `unnecessaryAssertions`    | Redundant or broad TypeScript assertions                                      |
| `lazyImportsAtTopLevel`    | Lazy imports kicked off at module load                                        |
| `commonjsInEsm`            | CommonJS patterns inside ESM modules                                          |
| `typeScriptEscapeHatches`  | `@ts-ignore`, unexplained `@ts-expect-error`, and similar escapes             |
| `analysisErrors`           | Structured info / warning / error notes (parse failures, skipped files, etc.) |

Type-aware findings (`unusedTypes`, `unusedClassMembers`, `misclassifiedDependencies`, etc.) are included by default when the project has enough TypeScript context for semantic analysis.

### Options

| Option                    | Description                                                    |
| ------------------------- | -------------------------------------------------------------- |
| `[root]`                  | Project root directory (default: `.`; must exist)              |
| `-e, --entry <pattern>`   | Entry point glob patterns                                      |
| `-i, --ignore <pattern>`  | Glob patterns to exclude                                       |
| `--extensions <ext>`      | File extensions to scan (e.g. `.ts` `.vue`)                    |
| `--tsconfig <path>`       | Path to tsconfig.json for alias resolution                     |
| `--paths <alias=target>`  | Explicit path-alias mappings (e.g. `@app/*=src/*`), repeatable |
| `--report-types`          | Include type-only exports in results                           |
| `--include-entry-exports` | Report unused exports from entry files                         |
| `--json`                  | Output results as JSON                                         |
| `--fail-on-issues`        | Exit 1 when non-cycle findings are found                       |
| `--fail-on-cycles`        | Exit 1 when circular imports are found                         |

### Exit codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| `0`  | Success (no failure flags triggered)                    |
| `1`  | Issues found (per `--fail-on-*` flags) or runtime error |
| `2`  | Invalid project root                                    |

### Confidence tiers

Every redundancy finding carries a confidence tier (`high` / `medium` / `low`) visible in human and JSON output. Use `high` for CI gates; `medium` and `low` are best as code-review prompts. Some patterns flagged at `medium` (`x ?? null`, single-name `duplicateConstants` across packages) have legitimate intent ripgrep alone can't disambiguate.

### Skipped files

Files identified as empty, binary, or minified bundles are skipped with an `info`-severity `analysisErrors` note. This isn't an error. It means the file looked machine-generated or non-source and was excluded from analysis to avoid producing irrelevant findings.
