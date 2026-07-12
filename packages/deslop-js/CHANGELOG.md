# deslop-js

## 0.7.6

### Patch Changes

- [#1114](https://github.com/millionco/react-doctor/pull/1114) [`76cd6be`](https://github.com/millionco/react-doctor/commit/76cd6bea69e1f453805a054e8d648abc97ef3384) Thanks [@aidenybai](https://github.com/aidenybai)! - Reduce cold full-scan CPU and allocation overhead with comment-tolerant security-rule content gates, semantic analysis only for rules that consume it, cached binding-mutation scans, analysis-local scope and reference caches, host-native component/export collection, combined state observation passes, single-pass control-flow construction, allocation-free and decorator-aware visitor-key traversal for closure-capture, effect cleanup, and React render analysis, lazy shadow-binding sets, constant-time dependency checks, compatible React Compiler plugin resolution, and newer Oxc parser and resolver releases. Preserve ESLint filename fallbacks, decorator scope semantics, scope-aware React HOC identity, and bodyless TypeScript declarations across the optimized analysis paths.

## 0.7.5

## 0.7.4

## 0.7.3

## 0.7.2

### Patch Changes

- [#1077](https://github.com/millionco/react-doctor/pull/1077) [`9cb4149`](https://github.com/millionco/react-doctor/commit/9cb414905de7b360d728ca08d45167116a94ee90) Thanks [@aidenybai](https://github.com/aidenybai)! - Align 30+ rules with their documented behavior, fixing the false-positive clusters confirmed by a validation pass of 2,143 sampled diagnostics against the official rule prompts. Highlights: `jsx-key` now flags key-after-spread (the documented hazard) instead of the safe key-before-spread shape and exempts props rest parameters; `no-did-update-set-state` honors the prop-comparison guard exemption; `no-console` skips Node CLI scripts; `circular-dependency` skips type-only, lazy-import, and render-time-only cycles; `query-mutation-missing-invalidation` exempts read-only mutations; `insecure-crypto-risk` requires cryptographic context instead of matching identifier names; `no-unknown-property` allows valid hyphenated SVG attributes; `no-aria-hidden-on-focusable` verifies the element is actually focusable; `no-flush-sync` implements the documented DOM-measurement carve-out.

## 0.7.1

## 0.7.0

### Minor Changes

- [#1057](https://github.com/millionco/react-doctor/pull/1057) [`ce49250`](https://github.com/millionco/react-doctor/commit/ce4925008d37d7c86a234e6b9c7c2c3afe873405) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Dead-code analysis is now incremental across scans. deslop-js gains an opt-in `incrementalCachePath` config field: one stat walk per run (following directory symlinks, like the glob scans it stands in for) validates four independently keyed layers — per-file parse summaries (mtime+size), the collected file list, the module-resolution map (dropped whenever the file set or a bundler/tsconfig-like config changes, since resolution is file-set-dependent), and the per-file package-reference facts behind the unused-dependency content scans. The same walk also answers the stale-package file-discovery globs (config/docs/rescue/package.json/nx/tsconfig scans, verified byte-identical against fast-glob), so a cached run never re-walks the tree for them. Entry resolution deliberately stays live every run (it reads config/doc/sibling-source content no fingerprint can validate); on cached runs it moves to a dedicated worker thread so its filesystem work overlaps the main-thread analysis instead of serializing after it. Every layer fails open — corrupt, truncated, or version/config-mismatched stores degrade to a fresh computation, never a wrong result — writes are atomic and skipped when clean, and results are byte-identical to an uncached run. Unused-export detection also indexes re-export edges by source module, dropping an O(entry points × edges) scan that dominated the detector on large repos.

  react-doctor points the analysis worker at a per-project summary store next to the existing whole-result dead-code cache, so a changed-files rescan of a large repo re-parses only what changed (sentry, 9k files: ~8.0s → ~3.2s with 0-10 files edited; ~4.0s after adding a file; the cache-fill run costs the same as an uncached scan). The worker also stops running the discarded DRY-pattern redundancy detectors (`reportRedundancy: false`), which shrinks the summary store by dropping fields only those detectors read, and reports the cache outcome as `deadCode.summaryCacheHits` / `deadCode.summaryCacheMisses` in anonymized telemetry (absent whenever no analysis consulted the store). `REACT_DOCTOR_NO_CACHE` (or the granular `REACT_DOCTOR_NO_DEAD_CODE_CACHE`) disables it.

### Patch Changes

- [#1060](https://github.com/millionco/react-doctor/pull/1060) [`ced746f`](https://github.com/millionco/react-doctor/commit/ced746f518f11e8283d488c4ff31c44e478bb0e5) Thanks [@rayhanadev](https://github.com/rayhanadev)! - The whole cache stack now survives CI's fresh checkouts, so the GitHub Action's persisted `REACT_DOCTOR_CACHE_DIR` actually warms every layer instead of only the content-addressed ones. The whole-repo scan-result cache moves under the shared per-project cache root (honoring `REACT_DOCTOR_CACHE_DIR` like the lint, sidecar, dead-code, and supply-chain caches — previously it silently escaped the action's cache into `node_modules/.cache` or the OS temp dir), and its key drops every stat-based fingerprint that a re-clone rotates: config files and gitignored dotenv files are now content-hashed, and the toolchain is keyed by package versions (matching the lint ruleset hash) rather than install mtimes. The stat-fingerprinted dead-code caches gain mtime repair (the ninja/restat pattern): entries carry a content-hash witness, and a stat mismatch over identical bytes — every file after a fresh checkout — re-hashes once, accepts the entry, and persists the refreshed stat so the cost is paid once per checkout, not per run. This covers core's whole-project dead-code result cache (per-file `(mtime, size, hash)` records replacing the stats-in-key fingerprint) and deslop-js's incremental summary store (parse summaries, package-reference facts, and the manifest/bundler-config fingerprints feeding the collect/resolution hashes). Expired supply-chain score entries are also pruned past their TTL so restored cache directories stop accumulating dead purls. Everything stays fail-open and byte-identical to an uncached scan; on a re-cloned repo with one changed file, a warm scan now replays ~100% of lint, sidecar, and parse work instead of starting cold.

- [#1056](https://github.com/millionco/react-doctor/pull/1056) [`20d81f6`](https://github.com/millionco/react-doctor/commit/20d81f6f26dc8f0562118076f835da2468591d5f) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Hardened the dead-code result cache key against two silent-staleness classes. The fingerprinted extension and manifest name lists are now imported from `deslop-js/analyzed-inputs` — a new dependency-free subpath export assembled from the same constants deslop's own readers consume — so a deslop upgrade that widens its walk can never under-invalidate the cache. And the key now includes `@react-doctor/core`'s own version, so upgrading react-doctor re-analyzes instead of replaying cached diagnostics shaped by an older core's post-processing. The cache schema-version constant remains for cache-format changes only.

## 0.6.3

## 0.6.2

## 0.6.1

## 0.6.0

### Patch Changes

- [#936](https://github.com/millionco/react-doctor/pull/936) [`ba2af1b`](https://github.com/millionco/react-doctor/commit/ba2af1b7faa5ef4e1ae39e6c3b786259fba23f1f) Thanks [@aidenybai](https://github.com/aidenybai)! - Update the license to MIT with additional restrictions: the software may not be used as training, fine-tuning, or evaluation data for machine-learning models or AI systems, nor sold or resold as a commercial product or service (e.g. a paid API, SaaS, or hosted/managed service) whose value derives substantially from the software, without prior written permission (contact founders@million.dev). Each version's additional restrictions expire on the second anniversary of its release, after which that version is available under the standard MIT License (an FSL-style grant of future license). Each published package now ships its own up-to-date `LICENSE` file so the terms travel with the tarball.

  The `react-doctor` CLI also now prints a one-time notice (once per run) when it detects it is running inside an AI/ML training pipeline or agent sandbox, pointing to the license terms.

- [#915](https://github.com/millionco/react-doctor/pull/915) [`b69f4a7`](https://github.com/millionco/react-doctor/commit/b69f4a75360ad17d1d149aeb9de16835e792606a) Thanks [@skoshx](https://github.com/skoshx)! - Fix false positives in Expo config plugin detection for package-name plugins and nested expo config

  Expo config plugins can be referenced by package name (not just local file paths) from `app.json` / `app.config.*`, but the collector dropped any plugin entry that didn't resolve to a local file — so packages referenced only as config plugins were reported as unused. The `app.config.{js,ts}` AST path also only matched a top-level `plugins` property and never descended into the standard `{ expo: { plugins: [...] } }` shape (the JSON `app.json` path already read `expo.plugins`).

  Fixed by:

  - Tracking package-name plugins (e.g. `@config-plugins/detox`, `@react-native-firebase/app`) alongside local file-path plugins
  - Descending into the nested `expo` object in the config-object AST collector
  - Marking those package-name plugins as used in `detectStalePackages` (gated on the declared dependency set, so unrelated strings can't suppress real unused deps)

  Closes [#914](https://github.com/millionco/react-doctor/issues/914)

- [#971](https://github.com/millionco/react-doctor/pull/971) [`a7ad969`](https://github.com/millionco/react-doctor/commit/a7ad969e5621ce1f61422b9bf578da600220d3e2) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix `deslop/unused-export` false positive for namespace-imported components used in JSX

  A component referenced only through a namespace import in JSX —
  `import * as S from "./style"` then `<S.Custom />` — was reported as an unused
  export. The usage walker recorded namespace member access in regular expressions
  (`MemberExpression`, e.g. `S.helper()`) but not in JSX (`JSXMemberExpression`),
  so a member used solely as `<S.x />` was missed whenever the namespace had any
  other accessed member. Closes [#875](https://github.com/millionco/react-doctor/issues/875).

- [#963](https://github.com/millionco/react-doctor/pull/963) [`03b7a5f`](https://github.com/millionco/react-doctor/commit/03b7a5f79e50d42f1d4f1aaddb2587605c8edde0) Thanks [@skoshx](https://github.com/skoshx)! - Exclude TypeScript 6.x to fix bunx installation crash

  TypeScript 6.0.3 has an internal circular dependency with its `Comparison` enum
  that triggers a known Bun module loader bug, causing `bunx react-doctor install`
  to crash with "ReferenceError: Cannot access 'Comparison' before initialization".
  Narrow the dependency range to `>=5.0.4 <6` until Bun fixes enum initialization
  order (see oven-sh/bun#12805).

  The constraint covers both `react-doctor` (whose CLI imports `typescript` at
  startup) and `deslop-js` (loaded by the dead-code scan, which can run under bun),
  so no published package pulls TypeScript 6.x into a consumer's install tree.

  `npx` continues to work because npm's resolver handles the circular dependency
  correctly. TypeScript 5.9.3 is stable and tested; TypeScript 6.x support will
  return once the upstream bug is resolved.

  Closes [#962](https://github.com/millionco/react-doctor/issues/962)

- [#916](https://github.com/millionco/react-doctor/pull/916) [`7f9e7f4`](https://github.com/millionco/react-doctor/commit/7f9e7f42832f40a32d7583126c096067f948856f) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Rework unused-dependency detection to lean on real package metadata instead of hand-maintained whitelists.

  - Treat any installed dependency that ships a CLI binary as used. A package that declares a `bin` is routinely invoked outside what a static scan can see (Makefiles, CI, git hooks, ad-hoc `npx`), so it's no longer flagged just because no `package.json` script names the binary. Empty `bin` fields (`""` / `{}`) don't count.
  - Drop the hardcoded fallback tables now that the bin/peer scans read real `node_modules` metadata: the binary→package map (`CLI_BINARY_TO_PACKAGE` + the `babel`/`jest`/`remark` fallbacks), the env-wrapper binary set, the static peer-dependency map, and the implicit-companion map. With dependencies installed (the normal scan condition) detection is unchanged — a package's real `bin` and `peerDependencies` cover what the tables used to hardcode.

  Trade-off: when scanning **without** `node_modules`, a CLI dependency whose binary name differs from its package name (e.g. `vp` → `vite-plus`) can no longer be resolved from scripts, and a few heuristic peer relationships that aren't declared `peerDependencies` (e.g. `@hookform/resolvers` → `zod`) are no longer inferred. The always-used lists for tooling that can't be detected statically (`typescript`, `eslint`, `@types/*`, `eslint-plugin-*`, …) are unchanged.

## 0.5.8

### Patch Changes

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Run dead-code analysis sequentially by default and scale its timeout to the repo size — fixing a silent drop of all dead-code findings on large supply-chain scans.

  Dead-code (deslop reachability) is CPU-bound, like the oxlint lint pass. Running them concurrently oversubscribed the cores: deslop's parse pool and the oxlint pool each size to all cores, so together they demanded ~2x the cores, thrashed, and the parse pass missed its in-worker timeout. On a large repo (where the pass already runs near the cap) the supply-chain pass bleeding into the dead-code phase was enough to tip it over, and the fail-open path then silently dropped EVERY dead-code finding — observed dropping all ~349 findings on ~2/3 of supply-chain-on Sentry scans, with no user-visible error.

  Dead-code now runs strictly after lint with the full core budget — fastest per-phase and never oversubscribed (overlapping two CPU-bound passes buys no wall-clock anyway). `REACT_DOCTOR_DEAD_CODE_OVERLAP=on` still forces the overlap, but the two pools now SPLIT the core budget — deslop's parse pool is capped via the new `DESLOP_PARSE_CONCURRENCY` env and lint shrinks to the remainder — so they sum to the cores instead of doubling them.

  The dead-code phase + in-worker timeouts now scale with the project's source-file count (and inversely with the dead-code core share when overlapped) instead of a flat cap, so a large repo's legitimately-long pass isn't reclaimed before it finishes; the ceiling still reclaims a genuinely wedged worker, and an explicit `REACT_DOCTOR_DEAD_CODE_PHASE_TIMEOUT_MS` override is honored verbatim. This supersedes the previous memory-gated dead-code overlap and replaces the flat dead-code phase cap with the size-scaled budget.

- [#880](https://github.com/millionco/react-doctor/pull/880) [`8bbcca8`](https://github.com/millionco/react-doctor/commit/8bbcca87daf06e60d0fa3005f8ad636fc929e513) Thanks [@aidenybai](https://github.com/aidenybai)! - Develop in the react-doctor monorepo. Package metadata (repository, homepage, bugs) now points at `millionco/react-doctor`, and `deslop-js` now ships the README and LICENSE its `files` list already declared. No runtime behavior changes.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Skip the deslop analysis passes whose output react-doctor discards — an ~8.5x speedup of the dead-code phase on large repos.

  react-doctor consumes only deslop's graph dead-code findings: unused files, unused exports, unused dependencies, and circular dependencies. The dead-code worker projects exactly those four off deslop's result (`check-dead-code.ts` `normalizeResult`); the other ~18 fields deslop computes never cross the worker boundary. Two of deslop's passes produce only discarded output and are the bulk of the runtime: the full-TypeScript-Program **semantic** pass (unused types / enum & class members / misclassified deps), and a set of **code-quality** detectors (duplicate-block / copy-paste detection, complexity hotspots, feature flags, TypeScript smells, private-type leaks, re-export cycles). Profiling a ~9k-file repo (Sentry) showed `generateReport` was ~90% of the phase and duplicate-block detection alone was ~83s of ~130s.

  deslop gains a `reportCodeQuality` flag (default `true`, so deslop used standalone is unchanged) that gates those six code-quality detectors — they were the only expensive detectors still running unconditionally while the cheaper redundancy detectors were already opt-in. react-doctor's dead-code worker now passes both `semantic: { enabled: false }` and `reportCodeQuality: false`.

  Measured on Sentry: deslop drops from ~132s to ~15.5s (8.5x) with byte-identical consumed findings (198 unused files, 10 unused exports, 4 unused deps, 137 cycles), and a full supply-chain-on scan drops from ~142s to ~40s. Skipping these is provably safe — each consumed finding comes from its own detector, independent of the disabled passes — and a parity test locks the invariant so a future deslop change that ever coupled a consumed finding to either pass fails CI first.

## 0.0.24

### Patch Changes

- [#38](https://github.com/millionco/deslop-js/pull/38) [`7279c5c`](https://github.com/millionco/deslop-js/commit/7279c5cad147c02a503fce5b3111dd0b31cab42d) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Stop flagging workspace package files imported by sibling workspaces via package subpaths (e.g. `@project/ui/button`) as unused when analyzing a single workspace package — including subpaths resolved through wildcard `exports` patterns (`"./*": "./src/*.tsx"`), nested export conditions, and exports targeting built `dist/` artifacts that exist on disk (entries map back to their `src/` sources) — and treat `vercel.ts`-style deploy-time config files as config files

## 0.0.23

### Patch Changes

- [#36](https://github.com/millionco/deslop-js/pull/36) [`ce34ef7`](https://github.com/millionco/deslop-js/commit/ce34ef770956bdb853309fc5abd62ce8572225c1) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Stop flagging dependencies referenced in prettier config files (`.prettierrc`, `.prettierrc.*`, `prettier.config.*`) as unused, e.g. scoped plugins like `@trivago/prettier-plugin-sort-imports`

## 0.0.22

### Patch Changes

- [#34](https://github.com/millionco/deslop-js/pull/34) [`3d2e8a1`](https://github.com/millionco/deslop-js/commit/3d2e8a1b755b6b11a9c627cecec96cf9d4706162) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add a `reason` field to each `unusedDependencies` finding that names the package and its declaring section (`dependencies` / `devDependencies`), so consumers can surface the specific unused dependency name instead of a generic grouped warning.

## 0.0.21

### Patch Changes

- [#32](https://github.com/millionco/deslop-js/pull/32) [`c666dbf`](https://github.com/millionco/deslop-js/commit/c666dbfcfc985dd23d4d2718a3a9480b300d543b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Auto-resolve path aliases by default and add a `paths` config option.

  `deslop` now infers cross-workspace `@scope/<dir>` imports from the monorepo layout (so files imported via an alias whose package name or tsconfig didn't cover it are no longer reported as unused), and reads alias mappings from Vite (`resolve.alias`), Jest (`moduleNameMapper`), and Babel (`module-resolver`) configs in addition to the existing tsconfig `paths` and webpack aliases. For anything not auto-detected, the new `paths` option (`--paths "@app/*=src/*"` on the CLI) declares explicit mappings.

- [#32](https://github.com/millionco/deslop-js/pull/32) [`c666dbf`](https://github.com/millionco/deslop-js/commit/c666dbfcfc985dd23d4d2718a3a9480b300d543b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Improve path-alias resolution accuracy. When multiple `paths` patterns match an import, the most specific one now wins (e.g. `@/components/*` is preferred over `@/*`), matching TypeScript's own resolution. Import specifiers are also sanitized before resolution — webpack inline-loader prefixes (`raw-loader!./x`), `?query` strings, and `#fragment` hashes are stripped (while Node.js `#subpath` imports are preserved) so their targets are no longer mis-reported as unused.

## 0.0.20

### Patch Changes

- [#30](https://github.com/millionco/deslop-js/pull/30) [`d284d20`](https://github.com/millionco/deslop-js/commit/d284d203f8bbbebe5e0d9b885c9332de0801f006) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Respect `.gitignore` when reporting unused code. Files matching a gitignore rule (e.g. generated/build output) are excluded from `unused-file` and `unused-export` results, but stay in the dependency graph so the real source they import is still counted as used — files imported only by a gitignored module are no longer falsely reported as unused. Personal/global gitignore rules are ignored so results are deterministic across machines, and analysis degrades gracefully (with an info-level note) when `git` is unavailable.

## 0.0.19

### Patch Changes

- [#25](https://github.com/millionco/deslop-js/pull/25) [`96a2311`](https://github.com/millionco/deslop-js/commit/96a23119bcaf6aa36b18ef155991514159bd5c8b) Thanks [@barclayd](https://github.com/barclayd)! - Astro's live content collections config (`src/live.config.ts`) is now recognized as an always-used entry point, matching the existing `src/content.config.ts` handling. Previously the file — and every module reachable only through it (live collection loaders, schemas, CMS clients) — was reported as `unused-file`, since Astro loads it by filename convention with no import statement anywhere in the project.

## 0.0.18

### Patch Changes

- [#26](https://github.com/millionco/deslop-js/pull/26) [`18dbfa8`](https://github.com/millionco/deslop-js/commit/18dbfa8ff174858a4f85c82397126ec24b05cf0f) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Parallelize file parsing with worker threads for projects with 50+ files, using greedy load-balanced concurrency (auto-detected CPU cores, clamped to [1, 16]). Falls back to sequential parsing on small projects or worker failure.

## 0.0.17

### Patch Changes

- [#23](https://github.com/millionco/deslop-js/pull/23) [`d83dc37`](https://github.com/millionco/deslop-js/commit/d83dc373a8ef2f8d22ffbb430ff9234cfef23e2a) Thanks [@aidenybai](https://github.com/aidenybai)! - `detectStalePackages` no longer reports a devDependency as unused when it's referenced in a `package.json` script as a flag argument rather than the leading command — e.g. `jest --testResultsProcessor jest-sonar-reporter` or `--reporters=jest-junit`. The script scan previously matched a package only as the command/binary token; it now also treats any declared package named as a standalone token anywhere in the command (including `@scope/pkg` and `pkg/subpath`) as referenced, while still ignoring tokens that merely contain the name as a substring.

## 0.0.16

### Patch Changes

- [#21](https://github.com/millionco/deslop-js/pull/21) [`696b690`](https://github.com/millionco/deslop-js/commit/696b690408a392cdbf3f76daf50949710e4c2ed6) Thanks [@aidenybai](https://github.com/aidenybai)! - Normalize collected source paths, analyzer path sets, and graph module paths to POSIX separators so Windows resolver and glob paths remain in the same import graph key space. This prevents reachable files and re-exported symbols from being dropped during dead-code analysis on Windows.

## 0.0.15

### Patch Changes

- [#18](https://github.com/millionco/deslop-js/pull/18) [`ae0f67a`](https://github.com/millionco/deslop-js/commit/ae0f67ac43907ca9538db9580f25bb418c8ee684) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add duplicate-block, cyclomatic complexity, feature-flag, TypeScript code-smell, and private-type-leak detectors, collect imports from Astro `<script>` blocks with recovery from partial parses, treat Expo Router `src/app` routes as entry points, normalize path separators on Windows, and reduce false positives across detectors.

- [#20](https://github.com/millionco/deslop-js/pull/20) [`24a9c69`](https://github.com/millionco/deslop-js/commit/24a9c6915d0e295c65c1bf437b9ac5aef5d72dfe) Thanks [@aidenybai](https://github.com/aidenybai)! - Treat Inertia, Redwood, Waku, Vike, Rakkas, and module federation page/config conventions as dependency-gated entry points to reduce orphan-file false positives.

## 0.0.14

### Patch Changes

- fix

## 0.0.13

### Patch Changes

- fix

## 0.0.12

### Patch Changes

- fix

## 0.0.11

### Patch Changes

- fix

## 0.0.10

### Patch Changes

- Add deslop-cli Commander package and improve dependency detection for pnpm/npm overrides and CLI binaries in package scripts.

## 0.0.9

### Patch Changes

- fix

## 0.0.8

### Patch Changes

- fix

## 0.0.7

### Patch Changes

- fix

## 0.0.6

### Patch Changes

- fix

## 0.0.5

### Patch Changes

- fix

## 0.0.3

### Patch Changes

- fix

## 0.0.2

### Patch Changes

- fix
