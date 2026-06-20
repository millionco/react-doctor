# @react-doctor/core

## 0.5.8

### Patch Changes

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Bound every long-running scan phase with a hard, runtime-independent timeout so a single wedged dependency socket, quadratic file, or starved event loop can no longer hang a scan for hours (production traces showed `runInspect` up to 16h and `Linter.run` up to 7.5h).

  - **Binary-split cascade** (`spawnLintBatches`): a cumulative split-time budget (`OXLINT_SPLIT_TOTAL_BUDGET_MS`, 3 min) and a recursion-depth cap (`OXLINT_SPLIT_MAX_DEPTH`, 8) now drop the remaining files of a pathological batch into the existing `onPartialFailure` / `skippedCheckReasons["lint:partial"]` channel instead of re-waiting a full spawn timeout at every split level.
  - **Supply-chain check**: a whole-check cap (`SUPPLY_CHAIN_TOTAL_TIMEOUT_MS`, 90s) fails open (no diagnostics) on a many-socket pileup that ignores the per-fetch abort — the same fail-open contract the per-package lookup already had.
  - **Dead-code & lint phases**: Effect-level caps (`REACT_DOCTOR_DEAD_CODE_PHASE_TIMEOUT_MS`, default 2.5 min; `REACT_DOCTOR_LINT_PHASE_TIMEOUT_MS`, default 5 min) sit above the existing per-unit timeouts and fold a timeout into the existing skipped-check / lint-failure contracts so the rest of the scan still completes. On interruption the dead-code worker and any in-flight oxlint subprocesses are SIGKILL'd (the `AbortSignal` is threaded down to both), so the cap actually reclaims the work instead of leaving orphaned processes running.
  - **Overall deadline**: `REACT_DOCTOR_SCAN_DEADLINE_MS` (default 15 min) backstops any phase not individually capped, raising the new `ScanDeadlineExceeded` reason on the `ReactDoctorError` union. It sits above the sum of the per-phase caps so a scan that legitimately uses those budgets degrades gracefully rather than hard-failing.

  All four caps are env-tunable so the budgets can be raised without a redeploy. The defaults sit well above measured p95, so only the pathological tail is affected — no behavior change for normal scans.

- [#890](https://github.com/millionco/react-doctor/pull/890) [`350a6ed`](https://github.com/millionco/react-doctor/commit/350a6edc59dff4d7d4adcb6c6348144ded900d8c) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Loosen the `typescript` dependency range to `>=5.0.4 <7` so consumers on TypeScript 5 can vendor `@react-doctor/core` without a forced TS 6 install. Every TypeScript compiler API the engine uses (`createSourceFile`, `forEachChild`, `parseConfigFileTextToJson`, and the AST type guards — the newest being `isTypeAssertionExpression`, TS 5.0) exists in TS 5.x, and this matches the range already declared by the published `react-doctor` CLI that bundles core.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Run dead-code analysis sequentially by default and scale its timeout to the repo size — fixing a silent drop of all dead-code findings on large supply-chain scans.

  Dead-code (deslop reachability) is CPU-bound, like the oxlint lint pass. Running them concurrently oversubscribed the cores: deslop's parse pool and the oxlint pool each size to all cores, so together they demanded ~2x the cores, thrashed, and the parse pass missed its in-worker timeout. On a large repo (where the pass already runs near the cap) the supply-chain pass bleeding into the dead-code phase was enough to tip it over, and the fail-open path then silently dropped EVERY dead-code finding — observed dropping all ~349 findings on ~2/3 of supply-chain-on Sentry scans, with no user-visible error.

  Dead-code now runs strictly after lint with the full core budget — fastest per-phase and never oversubscribed (overlapping two CPU-bound passes buys no wall-clock anyway). `REACT_DOCTOR_DEAD_CODE_OVERLAP=on` still forces the overlap, but the two pools now SPLIT the core budget — deslop's parse pool is capped via the new `DESLOP_PARSE_CONCURRENCY` env and lint shrinks to the remainder — so they sum to the cores instead of doubling them.

  The dead-code phase + in-worker timeouts now scale with the project's source-file count (and inversely with the dead-code core share when overlapped) instead of a flat cap, so a large repo's legitimately-long pass isn't reclaimed before it finishes; the ceiling still reclaims a genuinely wedged worker, and an explicit `REACT_DOCTOR_DEAD_CODE_PHASE_TIMEOUT_MS` override is honored verbatim. This supersedes the previous memory-gated dead-code overlap and replaces the flat dead-code phase cap with the size-scaled budget.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Skip the deslop analysis passes whose output react-doctor discards — an ~8.5x speedup of the dead-code phase on large repos.

  react-doctor consumes only deslop's graph dead-code findings: unused files, unused exports, unused dependencies, and circular dependencies. The dead-code worker projects exactly those four off deslop's result (`check-dead-code.ts` `normalizeResult`); the other ~18 fields deslop computes never cross the worker boundary. Two of deslop's passes produce only discarded output and are the bulk of the runtime: the full-TypeScript-Program **semantic** pass (unused types / enum & class members / misclassified deps), and a set of **code-quality** detectors (duplicate-block / copy-paste detection, complexity hotspots, feature flags, TypeScript smells, private-type leaks, re-export cycles). Profiling a ~9k-file repo (Sentry) showed `generateReport` was ~90% of the phase and duplicate-block detection alone was ~83s of ~130s.

  deslop gains a `reportCodeQuality` flag (default `true`, so deslop used standalone is unchanged) that gates those six code-quality detectors — they were the only expensive detectors still running unconditionally while the cheaper redundancy detectors were already opt-in. react-doctor's dead-code worker now passes both `semantic: { enabled: false }` and `reportCodeQuality: false`.

  Measured on Sentry: deslop drops from ~132s to ~15.5s (8.5x) with byte-identical consumed findings (198 unused files, 10 unused exports, 4 unused deps, 137 cycles), and a full supply-chain-on scan drops from ~142s to ~40s. Skipping these is provably safe — each consumed finding comes from its own detector, independent of the disabled passes — and a parity test locks the invariant so a future deslop change that ever coupled a consumed finding to either pass fails CI first.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Diagnostics are now emitted in a deterministic order across runs (JSON report, terminal output, on-disk dump, and the agent handoff), so two runs of the same repo produce byte-identical ordering instead of the parallel lint pass's arrival order. Lint scans also schedule the largest source files first (LPT batch ordering) for better wall-clock on large repos — a free reordering using the file size the minified-file gate already stat'd. Set `REACT_DOCTOR_LINT_BATCH_ORDERING=arrival` to fall back to discovery order. The diagnostics array content (and the JSON `schemaVersion`) is unchanged — only the ordering becomes deterministic.

- [#879](https://github.com/millionco/react-doctor/pull/879) [`9f733f7`](https://github.com/millionco/react-doctor/commit/9f733f7cff1055f631d69dbc84848efa948c0d89) Thanks [@skoshx](https://github.com/skoshx)! - Skip pnpm hardening check for monorepo sub-packages. Hardening settings are workspace-level and should only be checked at the workspace root or standalone pnpm projects.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Replace the fixed 16-worker lint ceiling with a memory-and-core-budgeted auto count (up to 32). The auto path now picks `min(cores, floor(availableMemory / 1 GiB))` clamped to `[1, 32]`, where `availableMemory` is `os.totalmem()` floored by the container's cgroup memory limit (read directly, since Node's memory APIs report the host total inside a container). `os.freemem()` is deliberately not used — it excludes reclaimable page cache and reads near-zero on macOS / cache-heavy Linux, which would have collapsed the default scan to a single worker.

  The 1 GiB/worker budget matches the per-worker footprint the old fixed-16 ceiling already tolerated (16 workers on a typical 16 GiB CI box), so machines with at least ~1 GiB per core stay core-bound and unchanged. A 32/64-core runner with enough memory now uses up to 32 workers instead of idling cores behind the old 16; a high-core but memory-starved box or container uses fewer workers so the oxlint native binding doesn't OOM (the existing `EAGAIN`/`ENOMEM` serial replay remains the runtime backstop). Past ~10 workers parallel efficiency already flattens, so this is headroom and OOM-safety, not a proportional speedup.

  The cgroup v2 limit is read from the mount-root `memory.max`, which is the container's limit under the standard cgroup-namespace setup CI runners use; a non-namespaced nested cgroup falls back to the host total (with the serial replay as the backstop).

  Note for `diagnose({ projects })` batch scans: each project's lint pass is budgeted independently against the whole machine, so a batch (default 4 concurrent projects) can now spawn up to `4 × 32` concurrent oxlint processes on a large runner (was `4 × 16`). The per-project `EAGAIN`/`ENOMEM` serial replay still backstops any over-subscription; dividing the per-project memory budget by the batch concurrency is a possible follow-up.

  Explicit `REACT_DOCTOR_PARALLEL=N` and `inspect({ concurrency: N })` pins are now clamped to 32 (was 16). The `[~N workers]` scan suffix can show more than 16 on large runners, and the `oxlint.workers` telemetry distribution (plus the wide-event `workerCount` / `parallel`) now reports the real resolved worker count on the default auto path instead of only when a count was pinned.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add a per-file content-addressed lint cache so repeat scans re-lint only the files whose content changed. On a warm scan the oxlint pass partitions the file list by content hash: unchanged files replay their cached raw diagnostics, and only changed files are re-linted. The five cross-file rules (`no-barrel-import`, `nextjs-missing-metadata`, `nextjs-no-use-search-params-without-suspense`, `no-mutating-reducer-state`, `rn-prefer-expo-image`) — whose verdict for a file can depend on _other_ files — always run fresh in a never-cached sidecar pass, so a dependency change can never serve a stale verdict. Output is byte-identical with the cache on or off (the design invariant), so the score, JSON report, and `inspect()`/`diagnose()` return values are unchanged.

  The cache is on by default and content-hashed (so it survives CI re-clones), and is automatically bypassed in audit mode, when an `extends` lint config is adopted, or when user plugins are configured. Disable it with `REACT_DOCTOR_NO_FILE_CACHE=1`; the existing `REACT_DOCTOR_NO_CACHE=1` now disables both the whole-repo scan cache and this per-file cache. A `cross-file-rules` guard test fails if a future rule starts reading other files without being carved into the always-fresh sidecar. The CLI reports cache effectiveness on its Sentry run event as `lintCacheHitRatio`.

  `oxlint-plugin-react-doctor` now exports `CROSS_FILE_RULE_IDS`, the canonical set of rules whose verdict can depend on other files.

- [#908](https://github.com/millionco/react-doctor/pull/908) [`2cadd3f`](https://github.com/millionco/react-doctor/commit/2cadd3fe2cb5b0476b35b1581c0a4c99bcdf1306) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Persist react-doctor's scan caches across CI runs (plan 10).

  In CI every commit is a fresh, SHA-scoped checkout, so the project-local `node_modules/.cache` never survives between commits — every run recomputes from scratch. This makes the engine's caches survivable:

  - **`REACT_DOCTOR_CACHE_DIR`** (new env): an operator/CI-pinned cache root. The GitHub Action points it at a stable `${runner.temp}` path and persists it with `actions/cache`, so the per-file content-addressed lint cache restores across runs — a PR re-lints only its changed files instead of the whole project. Keyed on the react-doctor version + lockfile + os/arch, with a `restore-keys` partial-hit fallback; the engine re-validates every restored entry by content hash + ruleset hash, so a stale entry simply misses and recomputes (no correctness risk).
  - **Supply-chain on-disk cache** (new): per-PURL Socket artifacts are cached under the cache dir with a 24h TTL (`SUPPLY_CHAIN_CACHE_TTL_MS`), so unchanged dependencies skip the network on repeated scans — locally and in CI — removing the bulk of the Socket fetches a full scan makes. Fail-open (a cache miss/error just fetches; a write failure never sinks the scan) and disabled by the existing `REACT_DOCTOR_NO_CACHE` off-switch.

  The `action.yml` cache wiring ships as an action release (cut a tag after dogfooding). A `--print-cache-key` flag for a tighter (ruleset-exact) actions/cache key is a possible follow-up; the version+lockfile key already restores soundly today.

- [#893](https://github.com/millionco/react-doctor/pull/893) [`4560b6d`](https://github.com/millionco/react-doctor/commit/4560b6dd39a6826f3d65476df12032cae7abfc63) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Propagate the V8 compile cache (`NODE_COMPILE_CACHE`) to oxlint batch subprocesses so later batches reuse warm bytecode. Measured ~2% of the lint phase on large multi-batch scans; no benefit for single-batch (`--diff`/`--staged`) scans. The dominant per-child cost is plugin eval/registration, which the compile cache does not address — this is a small internal speedup, not a headline. Opt out with `NODE_DISABLE_COMPILE_CACHE=1`.

- Updated dependencies [[`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae), [`8bbcca8`](https://github.com/millionco/react-doctor/commit/8bbcca87daf06e60d0fa3005f8ad636fc929e513), [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae), [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae)]:
  - deslop-js@0.5.8
  - oxlint-plugin-react-doctor@0.5.8

## 0.5.7

### Patch Changes

- [#848](https://github.com/millionco/react-doctor/pull/848) [`431e515`](https://github.com/millionco/react-doctor/commit/431e515260a209088c2305c6372249009dd95474) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop a broken `eslint-plugin-react-hooks` install from sinking the whole lint pass, and fix the misleading error it produced (issue [#833](https://github.com/millionco/react-doctor/issues/833)).

  When the optional `react-hooks-js` (React Compiler) plugin can't be imported in the user's environment, oxlint fails the entire config load — which previously dropped every curated react-doctor diagnostic too and left the scan with `skippedChecks: ["lint"]` and zero results. The oxlint error is also multi-line, and the 200-char error preview truncated its plugin path mid-string (often right at `…/node_modules/`), so it read as react-doctor passing an invalid directory rather than a plugin that failed to load.

  - **Graceful degradation:** the oxlint runner now detects a `react-hooks-js` plugin-load failure and retries once with that plugin (and its compiler rules) dropped — mirroring the existing adopted-`extends` fallback. The curated react-doctor rules, dead-code, and environment checks all still run; only the React Compiler rules are skipped, surfaced as a clear `lint:partial` note that includes oxlint's real underlying reason.
  - **Readable error:** the unparseable-output preview grew from 200 to 600 chars so the full plugin path and the underlying `Error:` line survive instead of being cut at `…/node_modules/`.

- Updated dependencies [[`424d8f9`](https://github.com/millionco/react-doctor/commit/424d8f9f914ff98b791af6b1f88337922c80c8ef), [`81bbfcc`](https://github.com/millionco/react-doctor/commit/81bbfcc39a0ae2f7d92ebb8860d854d09a60344d), [`937a7ca`](https://github.com/millionco/react-doctor/commit/937a7ca8a1b066a62210dc4a11149b9180dc9851), [`b8170f8`](https://github.com/millionco/react-doctor/commit/b8170f814c079d7bbc9e7796dd13646a6e8175fe), [`3f7d0e7`](https://github.com/millionco/react-doctor/commit/3f7d0e7ddb055b4970cba2b393ce14f6615732e4), [`6b8e756`](https://github.com/millionco/react-doctor/commit/6b8e756c40fe300634aec766edb00cbec73d8bc4), [`03301fc`](https://github.com/millionco/react-doctor/commit/03301fcdf4adcf256ef7ef7ed83f5566181ab371), [`44db3e0`](https://github.com/millionco/react-doctor/commit/44db3e0546fe0518b79e0aa2636754dcccda2939), [`5b742fa`](https://github.com/millionco/react-doctor/commit/5b742fa28c96443bd5bbd6348ad5aba55e17405c), [`8908f98`](https://github.com/millionco/react-doctor/commit/8908f98d02ad65e58d740ab948f8111948592cb9), [`451beeb`](https://github.com/millionco/react-doctor/commit/451beeb28405aa6810946e3311dfc7fb8de74632)]:
  - oxlint-plugin-react-doctor@0.5.7

## 0.5.6

### Patch Changes

- [#812](https://github.com/millionco/react-doctor/pull/812) [`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0) Thanks [@aidenybai](https://github.com/aidenybai)! - Add five `security-scan` rules distilled from security-researcher writeups and the deepsec scanner-matcher catalog, closing CWE shapes the bucket didn't cover:

  - **`unsafe-json-in-html`** — `JSON.stringify(...)` embedded in `dangerouslySetInnerHTML` or inline `<script>` markup. `JSON.stringify` does not HTML-escape, so data containing `</script>` or `<` breaks out — the classic SSR data-hydration XSS. Suppressed when an HTML-safe serializer (serialize-javascript, devalue, superjson) or `\u003c` escaping is used.
  - **`jwt-insecure-verification`** — the JWT `none` algorithm (`alg: none` / `algorithms: ["none"]`), which disables signature verification and lets any forged token through. (Detecting an unpinned `jwt.verify` precisely needs scope-aware analysis, so that is left to a future AST rule.)
  - **`secret-in-fallback`** — a secret-shaped env var with a hardcoded string fallback (`process.env.STRIPE_SECRET_KEY ?? "<hardcoded>"`): a committed secret that also makes the app fail open when the var is unset. Skips public vars (PUBLIC/PUBLISHABLE/ANON) and placeholder defaults.
  - **`request-body-mass-assignment`** — spreading or merging request input (`{ ...req.body }`, `Object.assign(target, req.body)`, lodash `merge`/`defaultsDeep`) without a field allowlist: mass assignment (client-set owner/role/price columns) or prototype pollution.
  - **`insecure-session-cookie`** — auth/session cookies exposed to JavaScript: `httpOnly: false`, set via `document.cookie`, or a bare `res.cookie("session", value)` / `cookies().set(...)` with no options.

  All five register through `defineRule` with a project-level `scan`, carry the `Security` category and `security-scan` tag, and are silenced by `react-doctor rules ignore-tag security-scan` like the rest of the family.

- [#824](https://github.com/millionco/react-doctor/pull/824) [`cf9e05b`](https://github.com/millionco/react-doctor/commit/cf9e05be8ee1f1781878c28b8342490ec11c176f) Thanks [@aidenybai](https://github.com/aidenybai)! - Show the full file total when the scan hands off to dead-code analysis, so the live counter no longer looks stuck below `N` ([#815](https://github.com/millionco/react-doctor/issues/815)).

  The linter already emits a final `(N, N)` progress tick when its last batch finishes, but ora throttles renders to its frame interval — that last frame was overwritten by the `"Analyzing dead code…"` text before it ever painted, so the spinner appeared to freeze at whatever value the smooth-creep timer last drew (e.g. `80/165`). Every file was always scanned; only the counter looked short. The dead-code phase now reads `Scanned N files, analyzing dead code…`, keeping the complete count visible for the whole (longer) dead-code pass.

- [#819](https://github.com/millionco/react-doctor/pull/819) [`5fc0e27`](https://github.com/millionco/react-doctor/commit/5fc0e270c9a15d25be96ef982755cea81065d141) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix false positives reported in the security and TanStack rules:

  - **`query-destructure-result`** ([#818](https://github.com/millionco/react-doctor/issues/818)): only flags `useQuery`/`useSuspenseQuery`/… when they actually come from a TanStack Query package (`@tanstack/*-query`, legacy `react-query`). A same-named hook imported from elsewhere — notably Convex's `useQuery` from `convex/react`, which returns the data directly — is no longer flagged.
  - **`artifact-env-leak` / `artifact-secret-leak`** ([#816](https://github.com/millionco/react-doctor/issues/816), [#817](https://github.com/millionco/react-doctor/issues/817)): no longer treat server-side or dev-mode Next.js output as browser artifacts. `.next/dev/server/**` (dev source maps), any `.next/**/server/**`, `.output/server/**`, and the dev server's `.next/dev/**` output are excluded; production browser bundles (`.next/static`, `dist/assets`, `public/`, …) are still scanned.
  - **`repository-secret-file`** / **`key-lifecycle-risk`** ([#813](https://github.com/millionco/react-doctor/issues/813)): no longer flag a credential/key file that git ignores — a local-only, gitignored `.env` is not "checked into the repository". Findings are dropped only when git definitively reports the path as ignored (the finding stands when there is no repo or git is unavailable).
  - **`webhook-signature-risk`** ([#814](https://github.com/millionco/react-doctor/issues/814)): recognizes a delegated verification helper (a call pairing a verify-ish verb with a security noun, e.g. `isValidSecret(...)`, `verifySignature(...)`, `checkWebhookHmac(...)`) as verification evidence, so an extracted `timingSafeEqual` comparison in another module no longer trips the rule.

- [#812](https://github.com/millionco/react-doctor/pull/812) [`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a `supabase-table-missing-rls` security-scan rule. It flags a Supabase migration (`supabase/migrations/**`, `supabase/schemas/**`) that runs `create table` for a public-schema table but never enables Row Level Security — the highest-impact and most common Supabase misconfiguration, because RLS is OFF by default for SQL-created tables, so every row is readable and writable with the public anon key. It targets the same misconfiguration Supabase's own `rls_disabled_in_public` database linter flags, and the gap that turns the public anon key into the service key.

  The existing `supabase-rls-policy-risk` only caught an explicit `disable row level security`; this complements it by catching the far more common "never enabled it" case. RLS is checked per table — each `create table` must have an `alter table <name> enable row level security` for that same table, after the create (a sibling table enabling RLS, or a policy without enabling it, does not vouch). SQL comments and string literals are ignored, non-public/Supabase-managed schemas (`auth.`, `storage.`, a `private.` schema, …) are skipped, and the rule is scoped to the `supabase/` directory so plain Drizzle/Prisma `.sql` migrations are not flagged. The scan runs per migration file, so enabling RLS in a _different_ migration than the `create table` is not detected — the same-file pattern (what Supabase tooling emits) is the supported case. Like the rest of the family it carries the `security-scan` tag and is silenced by `react-doctor rules ignore-tag security-scan`.

- [#823](https://github.com/millionco/react-doctor/pull/823) [`bac7c82`](https://github.com/millionco/react-doctor/commit/bac7c82950e2392ac4b21448f3e9cf86b605567f) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix a supply-chain scan crash on npm dist-tags and wildcards ([#807](https://github.com/millionco/react-doctor/issues/807)).

  `resolveConcreteVersion` called `semver.minVersion(spec)` directly, but `semver` **throws** (`TypeError: Invalid comparator: latest`) on a non-range spec instead of returning `null`. Any full scan — or PR scan touching `package.json` — containing a dist-tag like `"trigger.dev": "latest"` (or `"next"`) crashed before the Socket fail-open path could run (regression from [#804](https://github.com/millionco/react-doctor/issues/804), affecting 0.5.3–0.5.5).

  The spec is now validated with `semver.validRange` before resolving its floor: dist-tags and other non-ranges are skipped (nothing to score), as is a wildcard-only range (`*`/`x`/`X`), which previously resolved to a synthetic `0.0.0` and scored a version nobody pinned. Real ranges (`^1.2.3`, `1.x`, `>=2 <3`) and protocol/URL specs (`workspace:`, `file:`, `npm:`, `git+…`) are unchanged.

- Updated dependencies [[`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0), [`5fc0e27`](https://github.com/millionco/react-doctor/commit/5fc0e270c9a15d25be96ef982755cea81065d141), [`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0)]:
  - oxlint-plugin-react-doctor@0.5.6

## 0.5.5

### Patch Changes

- Updated dependencies [[`e90eb7a`](https://github.com/millionco/react-doctor/commit/e90eb7acbfc4e06de68de2cb6a96d3242f72963e)]:
  - oxlint-plugin-react-doctor@0.5.5

## 0.5.4

### Patch Changes

- [#744](https://github.com/millionco/react-doctor/pull/744) [`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a project-level security file scan: 36 first-class scan rules (leaked artifact secrets and env dumps, permissive Firebase/Supabase rules, raw SQL injection risk, unsafe webhook signature comparisons, committed private key material, public debug artifacts, …) ship in the oxlint plugin as ordinary `defineRule` modules that declare a project-level `scan` instead of AST visitors and run in `@react-doctor/core`'s environment-check phase over one bounded whole-tree walk — covering shipped bundles, dotenv/config files, SQL, and Firebase rules files that per-file linting never sees.

  Scan rules register metadata (id, title, severity, recommendation, `Security` category, `security-scan` tag) like any other rule but carry a project-level `scan` instead of AST visitors, so their findings flow through the standard diagnostic pipeline: per-rule and per-category severity overrides, inline disables, and output `surfaces` now apply to scan-rule diagnostics, and `react-doctor rules ignore-tag security-scan` (config `ignore.tags`) silences the whole family. They never appear in generated oxlint configs or the ESLint presets — they only execute through React Doctor's scan. A plain `--diff` / `--staged` scan skips them like the other whole-project checks, and the gate is now diff mode itself rather than the presence of include paths, so projects configuring `ignore.files` get the security scan too.

- Updated dependencies [[`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb), [`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb)]:
  - oxlint-plugin-react-doctor@0.5.4

## 0.5.3

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.5.3

## 0.5.2

### Patch Changes

- [#769](https://github.com/millionco/react-doctor/pull/769) [`2f26228`](https://github.com/millionco/react-doctor/commit/2f26228e36cfe64a430a41596d7b1053d6d7d307) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Consolidate the scan-scope controls into one `--scope` flag (and `scope` config option) with four values, shared verbatim by the CLI and the GitHub Action:

  - `full` (default) — the whole project, every issue. Whole-project checks (dead-code, environment, supply-chain) run only here.
  - `files` — only the files changed vs the base, with all issues in them (no compare-to-main). What `--staged` and an uncommitted `--diff` did.
  - `changed` — only issues the change introduced vs the base (the baseline delta). What `--diff <base>` and the action's `scope: changed` did.
  - `lines` — only issues on the lines the change actually touched. New: previously this scoping existed only inside the GitHub Action's inline-review-comment step; it now lives in the engine, so the CI gate, score display, summary, and inline comments all honor one scope.

  `--base <ref>` sets the comparison base for `files` / `changed` / `lines` (auto-detected when omitted). Behavior is unchanged by default: the CLI `--scope` defaults to `full` and the action `scope` input still defaults to `changed`. `--diff` / `config.diff` keep working as a deprecated alias (`--diff <base>` → `--scope changed --base <base>`, `--diff false` → `--scope full`) and emit a one-time deprecation warning; `--staged` is retained as the source selector and composes with `--scope files` / `--scope lines`.

- [#783](https://github.com/millionco/react-doctor/pull/783) [`a48fb06`](https://github.com/millionco/react-doctor/commit/a48fb06ffbe7221655e18529fcc954ecae17a22f) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Add a `--output-dir <dir>` flag that writes the full diagnostics dump (diagnostics.json + one .txt per rule) to a directory of your choice instead of a random temp folder, prints the written path whenever the flag is set (previously `--verbose`-only), and makes the agent handoff reuse that directory instead of writing a second temp copy. Without the flag, behavior is unchanged.

- Updated dependencies [[`94f9f4f`](https://github.com/millionco/react-doctor/commit/94f9f4fe98207181958f82275b41d94963bc73a2), [`038aaf7`](https://github.com/millionco/react-doctor/commit/038aaf78c12f7f9a2699f46d3a6aa304dc69fc12), [`fee3fc4`](https://github.com/millionco/react-doctor/commit/fee3fc436e502ad4a6609ab8bda9c9a782d8ecd7), [`c4f0e60`](https://github.com/millionco/react-doctor/commit/c4f0e607b6092485d226c0d67c783270f4eec8b2), [`f52bd07`](https://github.com/millionco/react-doctor/commit/f52bd0737527df9ab81f3746e64bdb5ac1defbc7), [`7c88165`](https://github.com/millionco/react-doctor/commit/7c8816575aff26f11b5099c7ef009c4793fe260f)]:
  - oxlint-plugin-react-doctor@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [[`77a70ab`](https://github.com/millionco/react-doctor/commit/77a70ab8a78dd21dc305a6c2b924e4bbc44058ce)]:
  - oxlint-plugin-react-doctor@0.5.1

## 0.5.0

### Minor Changes

- [#756](https://github.com/millionco/react-doctor/pull/756) [`93d4eec`](https://github.com/millionco/react-doctor/commit/93d4eecdb8e9e339f4258e67fcfc3649e2024ede) Thanks [@NisargIO](https://github.com/NisargIO)! - React Doctor now runs on repositories that don't depend on React. Previously a scan hard-failed with `No React project found` / `No React dependency`, even though many checks (security, bundle size, JS performance, architecture, and the Zod rules) are framework-agnostic and apply to any TypeScript / JavaScript codebase.

  A project is now analyzable when it has source files, with or without React. A bare directory of TypeScript files — including a monorepo's `packages/` subfolder that has no `package.json` of its own — is scanned by inheriting dependency/framework detection from the enclosing workspace root.

  React-flavoured rules stay off without React. A new `react` capability (set only when React or Preact is present) gates every React-runtime rule family (hooks, JSX, accessibility, render performance, React state) plus any rule tagged `react-jsx-only`, so hook/component-name heuristics like `rules-of-hooks`, `no-legacy-class-lifecycles`, and `no-nested-component-definition` can't false-fire on ordinary TypeScript. Once React (or Preact) is detected, every rule behaves exactly as before.

### Patch Changes

- [#741](https://github.com/millionco/react-doctor/pull/741) [`963eaf5`](https://github.com/millionco/react-doctor/commit/963eaf53db7de069baf2c7d18075443c3d934f9b) Thanks [@NisargIO](https://github.com/NisargIO)! - Add a `no-vulnerable-react-server-components` security check that flags projects running React Server Components on a version with a known advisory — primarily the critical unauthenticated RCE (CVE-2025-55182, CVSS 10.0), and the later high-severity DoS (CVE-2026-23870).

  It resolves the concrete installed version of React's RSC runtime and compares it against the patched releases per minor line (19.0 → 19.0.6, 19.1 → 19.1.7, 19.2 → 19.2.6). Frameworks and bundlers that expose `react-server-dom-*` directly (Vite, Parcel, React Router, Waku, RedwoodSDK) are checked by those package versions; Next.js — which vendors its own RSC runtime — is checked by its `next` version and the easiest corrective fix points at a Next.js upgrade (15.5.18 / 16.2.6) rather than a React bump. Pure client-side React apps with no RSC packages and no Next.js are unaffected and stay quiet, and the check never flags off an ambiguous declared range whose lockfile may resolve to a patched version.

- Updated dependencies [[`b4b79ad`](https://github.com/millionco/react-doctor/commit/b4b79addce225c47048127e04be2670c13bca332), [`af98f83`](https://github.com/millionco/react-doctor/commit/af98f83614526cca30f3a31ec2507a5df5da2bed), [`93d4eec`](https://github.com/millionco/react-doctor/commit/93d4eecdb8e9e339f4258e67fcfc3649e2024ede)]:
  - oxlint-plugin-react-doctor@0.5.0

## 0.4.2

### Patch Changes

- [#721](https://github.com/millionco/react-doctor/pull/721) [`d17dc87`](https://github.com/millionco/react-doctor/commit/d17dc87865e059f21534990d0925115db439dc3e) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a `defineConfig` helper for authoring a typed `doctor.config.{ts,js,mjs,cjs}` and read `react-doctor.config.json` as a deprecated fallback.

  `defineConfig` is exported from `react-doctor/api` (and `@react-doctor/api` / `@react-doctor/core`) as an identity helper that gives editor autocomplete and type-checking without an explicit `satisfies ReactDoctorConfig` annotation:

  ```ts
  // doctor.config.ts
  import { defineConfig } from "react-doctor/api";

  export default defineConfig({
    lint: true,
    rules: { "react-doctor/no-array-index-as-key": "off" },
  });
  ```

  The pre-migration `react-doctor.config.json` filename is now read as the lowest-priority fallback (after `doctor.config.*` and `package.json#reactDoctor`) instead of being ignored, so an un-migrated config keeps applying. It still emits a deprecation warning nudging a rename, and interactive runs continue to auto-migrate it to `doctor.config.ts`. A present-but-broken legacy file stops config resolution (it won't silently inherit an ancestor repo's config), and `react-doctor rules <...>` migrates a legacy file to `doctor.config.json` on write rather than editing it in place.

  Note: a `react-doctor.config.json` that was previously ignored in non-interactive runs (CI, coding agents, `--json`/`--score`/`--staged`) is now honored again, which can change which rules fire, the score, and PR gating for projects that still have one. Rename it to `doctor.config.json` (or delete it) to avoid surprises.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.4.2

## 0.3.1

### Patch Changes

- [#715](https://github.com/millionco/react-doctor/pull/715) [`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Disable `server-fetch-without-revalidate` on Next.js 15+ projects. Next.js 15 changed the default fetch behavior from cached-forever to `no-store`, making the rule's warning obsolete. Adds Next.js version detection (workspace- and `catalog:`-aware, mirroring Expo/FlashList resolution) and the `nextjs:15` capability gate.

- Updated dependencies [[`dc35070`](https://github.com/millionco/react-doctor/commit/dc35070a5066f9864a7565b952dec2f81bff1223), [`b1a22ef`](https://github.com/millionco/react-doctor/commit/b1a22efdf7b18f2cc8b7af6c0b12173ed3c76d34), [`73dcb20`](https://github.com/millionco/react-doctor/commit/73dcb2040dc6aa207beea074f846fd675c30bd2b), [`64667da`](https://github.com/millionco/react-doctor/commit/64667dae16b812ad9b4304bd7906d5ddbb50921a), [`ee9ab33`](https://github.com/millionco/react-doctor/commit/ee9ab336d3b2918d319bc048b5b164f58611df83), [`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b), [`831cf3f`](https://github.com/millionco/react-doctor/commit/831cf3fbfd703f5048de5c2c3258e47988a2cce0)]:
  - oxlint-plugin-react-doctor@0.4.1

## 0.3.0

### Minor Changes

- [#663](https://github.com/millionco/react-doctor/pull/663) [`9a8ad6e`](https://github.com/millionco/react-doctor/commit/9a8ad6e40d9ed1fbe7ddb1f1c57bfd5c791a4b9e) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Rework CI reporting: a renamed `blocking` gate, PR-introduced-issues-only baselines, inline PR review comments, and a simpler CLI flag surface.

  **CI gate**

  - **`fail-on` is renamed to `blocking`** (CLI `--blocking <level>`, config `blocking`, GitHub Action `blocking` input). Same `error | warning | none` values, default `error`: a scan fails CI when an `error`-severity diagnostic reaches the `ciFailure` surface; `warning` blocks on any diagnostic; `none` stays advisory (always exits 0). `--fail-on` / `failOn` still work as a deprecated, warned alias hidden from `--help`.
  - `--blocking warning` now wins over `--no-warnings` (it previously silently no-op'd the gate — you can't block on warnings you've hidden).

  **Baseline — report only the issues a PR introduces (Codecov-style)**

  - In `--diff <base>` mode, react-doctor runs a second lint pass over the changed files as they existed at the base merge-base and reports only the diagnostics the change introduced; pre-existing findings that merely shifted lines are matched out by a content fingerprint (`file + rule + flagged-line hash`). The head project-health **score is unchanged**; the gate fails on newly-introduced errors only. If the baseline can't be computed (base unreachable, or a lint pass failed), the run degrades to a plain diff — all findings stay visible and CI isn't gated on findings whose new-vs-pre-existing attribution is unknown.
  - **New core API:** `computeDiagnosticDelta`, `Git.showRefContent` / `Git.mergeBase`, `materializeSourceTree`, and `InspectOptions.baseline` / `InspectResult.baselineDelta`.
  - **JSON report v2:** baseline runs emit `schemaVersion: 2` with a `baseline` block (`newCount`, `fixedCount`, `baseTotalCount`) and `mode: "baseline"`; `summary.score` stays the head score. v1 reports are unchanged.

  **GitHub Action**

  - Posts **inline PR review comments** on the changed lines that triggered each diagnostic (with fix guidance + a docs link), plus a restyled CLI-style sticky summary with linkable findings and the new / fixed delta. The `annotations` input was removed.
  - On pull requests it fetches the base commit for baselining — use `fetch-depth: 0` on `actions/checkout`. New `fixed-issues` output. Defaults: `project: "*"`, `node-version: 24`.

  **CLI flags (fewer flags, fewer footguns)**

  - `--explain` / `--why` → the `react-doctor why <file>:<line>` subcommand (`rules explain <rule>` still explains what a rule means).
  - Removed `--full` (use `--diff false` to force a full scan), `--pr-comment` (the Action renders its comment from `--json`), and the positive `--respect-inline-disables` (already the default; use `--no-respect-inline-disables` for audit mode). The internal `--changed-files-from` is hidden from `--help`.
  - Removed flags now fail with a migration error instead of being silently dropped, and an empty `--project` filter (e.g. `--project ","`) is rejected.

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.4.0

## 0.2.19

### Patch Changes

- Updated dependencies [[`eba20ae`](https://github.com/millionco/react-doctor/commit/eba20ae9a708af81c7d95dbdadf16c8e5c6d21f9), [`5d7b36b`](https://github.com/millionco/react-doctor/commit/5d7b36bc315ba4c0a8ba6b60bd781a11efbed94f)]:
  - oxlint-plugin-react-doctor@0.3.0

## 0.2.18

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.18

## 0.2.17

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.17

## 0.2.16

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.16

## 0.2.15

### Patch Changes

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Collapse diagnostic categories into five clear, outcome-based buckets: **Security**, **Bugs**, **Performance**, **Accessibility**, and **Maintainability**. The previous fine-grained labels (Correctness, State & Effects, React Compiler, Next.js, React Native, Server, TanStack Query/Start, Preact → Bugs; Bundle Size → Performance; Architecture/Design → Maintainability) now roll up so the scan output reads as plain issue types at a glance.

  This changes the `category` value on every diagnostic (CLI output, the per-error headline prefix like `Security: Use of eval()`, and JSON/programmatic output). If you key `categories` severity overrides off the old names, update them to the new buckets. Dead-code findings (unused files/exports/dependencies, circular imports) now report `Maintainability` instead of `Dead Code`. Bundle-size findings now sort with `Performance` (higher stakes) rather than near the bottom of the top-errors block.

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix dead-code analysis silently failing ("Scanning failed (dead-code analysis, non-fatal).") on type-heavy projects. deslop's semantic pass builds a full TypeScript program and walks every identifier through the type checker; on projects with large generic types (tRPC routers, Effect/Zod schemas, deep generics) the checker instantiates enormous types and the child process exceeds Node's default ~4 GB heap, dying with an uncatchable "JavaScript heap out of memory" that surfaced as empty worker output and a non-fatal scan failure. The dead-code worker child is now spawned with `--max-old-space-size=8192` so those projects complete instead of crashing.

- Updated dependencies [[`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7), [`75c1f99`](https://github.com/millionco/react-doctor/commit/75c1f99e062a8fc3e5e4ba294208dbc56bca5f6f)]:
  - oxlint-plugin-react-doctor@0.2.15

## 0.2.14

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.13

## 0.2.12

### Patch Changes

- Updated dependencies [[`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de), [`d0f5206`](https://github.com/millionco/react-doctor/commit/d0f52062e09c7bfe11eda2c06ad6e9ab0ab7da58), [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb)]:
  - oxlint-plugin-react-doctor@0.2.12

## 0.2.11

### Patch Changes

- Updated dependencies [[`6f8640f`](https://github.com/millionco/react-doctor/commit/6f8640f6d98a75db90d28b56fdaf5abc81a53163)]:
  - oxlint-plugin-react-doctor@0.2.11

## 0.2.10

### Patch Changes

- Add Preact project detection and capability wiring. Scans now distinguish pure Preact projects from `preact/compat` setups and still enable Preact rules for Vite + Preact projects where the build framework remains `vite`.

- Add React minor-version capability parsing for APIs that ship after a major release. `react:19.2` now gates the `<Activity>` rule instead of enabling it for every React 19 project.

- Fix dead-code scan freezes by running analysis through a bounded worker path and continuing the inspect pipeline when analysis stalls or errors.

- Carry the latest rule-plugin capability updates through core, including Preact, Jotai, React Native performance, JS performance, HTML correctness, accessibility, and state-and-effects checks.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.10`.

## 0.2.9

### Patch Changes

- Dependency bump: `oxlint-plugin-react-doctor@0.2.9`.

## 0.2.8

### Patch Changes

- add react-doctor.config.json schema field

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.8

## 0.2.7

### Patch Changes

- Unify the dual diagnostic-filter pipelines into a single `buildDiagnosticPipeline` source of truth, removing a longstanding divergence between CLI and API filtering.

- Wire the `Progress` service into `runInspect`, eliminating the manual spinner `Ref` plumbing that leaked implementation details into renderers.

- Move scattered magic numbers into `constants.ts` with unit-suffixed `SCREAMING_SNAKE_CASE` names per project conventions.

- Consolidate `isProjectBoundary` helpers and rename the event-handler `isFunctionLike` to avoid collision with the oxlint plugin's AST utility of the same name.

- Push score-surface filtering into `runInspect` so downstream consumers no longer need to re-apply surface filters.

- Add `resolveScanTarget` helper and share `restoreLegacyThrow` across CLI and API entry points.

- Emit automated agent guidance (issue-reporting links) in inspect output for AI-assisted workflows.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.7

## 0.2.6

### Patch Changes

- Inherit the `design-no-bold-heading` rule removal from `oxlint-plugin-react-doctor@0.2.6`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.6

## 0.2.5

### Patch Changes

- Add `require-pnpm-hardening` environment check that warns when `pnpm` is detected without strict lockfile settings, helping prevent phantom dependency issues.

- Cover child workspace diff include paths so `--diff` mode in monorepos correctly scans files changed inside nested workspace packages, not just the root.

- Fix Node 20 runtime dependency support so the core package resolves correctly without Node 22+ built-ins.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.5

## 0.2.4

### Patch Changes

- **Effect v4 foundation.** Introduce tagged error classes (`Schema.TaggedErrorClass`), `Schema.Class` wire records for diagnostics and reports, `Context.Reference` for ambient config, and branded `Schema.brand` paths (`OxlintBinaryPath`, `NodeBinaryPath`). All fallible operations now fail with `ReactDoctorError` carrying a `reason` union that renderers dispatch on via `Effect.catchReasons`.

- **10 Effect v4 services.** Stand up `Files`, `Git`, `Project`, `Config`, `Linter`, `DeadCode`, `Score`, `Reporter`, `Progress`, and `NodeResolver` as `Context.Service` classes with `layerNode` / `layerOf` / `layerCapture` / `layerNoop` test variants.

- **`runInspect` streaming orchestrator.** Replace the imperative scan loop with a per-element pipeline that streams diagnostics through `buildDiagnosticPipeline`, enabling concurrent lint + dead-code analysis and real-time progress reporting.

- **Collapse `@react-doctor/types` and `@react-doctor/project-info` into `@react-doctor/core`**, reducing the workspace package count and simplifying imports.

- **Opt-in OpenTelemetry export.** Set `REACT_DOCTOR_OTLP_ENDPOINT` and `REACT_DOCTOR_OTLP_AUTH_HEADER` to ship every `Effect.fn("Service.method")` span and top-level `Effect.withSpan` to an OTLP-compatible backend.

- **User-plugin extension.** `config.plugins: [...]` loads additional oxlint plugin packages alongside the built-in rule set so teams can ship custom rules.

- **Security fixes.** Pin CI workflow permissions, add fork guards, fix four pre-existing audit findings.

- **Adopt `Effect.Console` throughout.** Drop the custom `Logger` service; renderers and services use `Console.log` / `Console.warn` / `Console.error` from `effect/Console`, which is swappable for tests via `Console.Console` service override.

- **Git service.** DI-wrap every `spawnSync('git', ...)` call site behind the `Git` service, then replace `spawnSync` with Effect's `ChildProcess` for non-blocking execution.

- **`NodeResolver` + `StagedFiles` services.** Remove the last `Effect.runSync` hack from `Linter.layerOxlint` by lifting Node resolution and staged-file discovery into their own services.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.4

## 0.2.3

### Patch Changes

- Fix vite build configuration for bundling workspace dependencies so `@react-doctor/core` resolves internal imports correctly at publish time.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.3
  - @react-doctor/project-info@0.2.3
  - @react-doctor/types@0.2.3

## 0.2.2

### Patch Changes

- Restore `eslint-plugin-react-hooks` as a hard dependency so React Compiler rules resolve without requiring users to install the peer separately.

- [#273](https://github.com/millionco/react-doctor/pull/273) [`47772b7`](https://github.com/millionco/react-doctor/commit/47772b7da4f6e412b09e3a4f74d888307faf74a1) - Natively port the 8 rules from `eslint-plugin-react-you-might-not-need-an-effect`
  (NickvanDyke, MIT) into `oxlint-plugin-react-doctor`. They now ship as
  `react-doctor/*` rules and no longer require the optional peer
  dependency. The optional peer-dep surface (`effect/*` rules,
  `resolveYouMightNotNeedEffectPlugin`,
  `YOU_MIGHT_NOT_NEED_EFFECT_NAMESPACE`) is removed from
  `@react-doctor/core`.

  The ports use a real `eslint-scope` ScopeManager (cached per Program
  via `WeakMap`) - same `references` / `resolved.defs[].node.init` /
  `isEventualCallTo` chasing the upstream plugin uses. Diagnostic
  messages match upstream verbatim with template variables substituted
  in JS.

  | Rule (now `react-doctor/<id>`)      | What it catches                                                          |
  | ----------------------------------- | ------------------------------------------------------------------------ |
  | `no-derived-state`                  | Storing derived state via a useEffect instead of computing during render |
  | `no-chain-state-updates`            | Chaining state updates across effects                                    |
  | `no-event-handler`                  | Using state + a guarded effect as an event handler                       |
  | `no-adjust-state-on-prop-change`    | Adjusting state in an effect when a prop changes                         |
  | `no-reset-all-state-on-prop-change` | Resetting all state in an effect (use a `key` prop)                      |
  | `no-pass-live-state-to-parent`      | Pushing live state to a parent via a callback in an effect               |
  | `no-pass-data-to-parent`            | Passing fetched data to a parent via a callback in an effect             |
  | `no-initialize-state`               | Initializing state inside a mount-only effect                            |

  Parity coverage: 195 of 196 upstream test cases pass (the 1 remaining
  case is upstream's own `todo: true`, "Set derived state via identical
  intermediate setter").

  These coexist with React Doctor's existing thematically-related rules
  (`no-derived-state-effect`, `no-effect-chain`, `no-event-trigger-state`,
  `no-prop-callback-in-effect`) - different IDs, different shapes,
  different messages.

- Updated dependencies [[`47772b7`](https://github.com/millionco/react-doctor/commit/47772b7da4f6e412b09e3a4f74d888307faf74a1)]:
  - oxlint-plugin-react-doctor@0.2.2
  - @react-doctor/project-info@0.2.2
  - @react-doctor/types@0.2.2

## 0.2.1

### Patch Changes

- Make filesystem walks tolerate EPERM/EACCES (macOS Library)

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.1
  - @react-doctor/project-info@0.2.1
  - @react-doctor/types@0.2.1

## 0.2.0

### Minor Changes

- [`5be2ead`](https://github.com/millionco/react-doctor/commit/5be2eadd90b2248b28b228fad306808cec1bf758) - Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

- [`809e38c`](https://github.com/millionco/react-doctor/commit/809e38cebabc15c42b3c40ee8c7a753c3d7549d0) - Extract project / dependency / framework detection, the oxlint runner +
  scoring engine, and the shared TypeScript type layer out of the
  `react-doctor` monolith into three new public workspace packages:
  `@react-doctor/types`, `@react-doctor/project-info`, and
  `@react-doctor/core` ([#249](https://github.com/millionco/react-doctor/issues/249)). The oxlint plugin is restructured into
  per-rule modules under `src/plugin/rules/<category>/<rule>.ts` with a
  codegen'd `rule-registry.ts` ([#218](https://github.com/millionco/react-doctor/issues/218), [#228](https://github.com/millionco/react-doctor/issues/228), [#230](https://github.com/millionco/react-doctor/issues/230), [#231](https://github.com/millionco/react-doctor/issues/231), [#234](https://github.com/millionco/react-doctor/issues/234), [#235](https://github.com/millionco/react-doctor/issues/235), [#236](https://github.com/millionco/react-doctor/issues/236),
  [#242](https://github.com/millionco/react-doctor/issues/242)). Land the user-feedback sweep ([#208](https://github.com/millionco/react-doctor/issues/208)): scoring transparency hooks,
  per-rule severity + rule-set selection config options, and reduced
  false positives across the design / Tailwind / state-and-effects rule
  families. Reorganise the CLI into `cli/commands/` + `cli/utils/`
  ([#250](https://github.com/millionco/react-doctor/issues/250)), and forward `reactMajorVersion` through programmatic
  `diagnose()` ([#174](https://github.com/millionco/react-doctor/issues/174)).

### Patch Changes

- [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c) - Rule-fix wave for the 0.2.0-beta.5 release:

  - Scope `no-secrets-in-client-code` to client-reachable bindings -
    skips server-only modules, public env-prefixed values, and
    locally-classified safe files ([#252](https://github.com/millionco/react-doctor/issues/252)).
  - `nextjs-no-side-effect-in-get-handler` stops flagging
    `response.headers.set(...)` and locally-constructed `Map` / `Set` /
    `Headers` inside GET handlers; the same safe-bindings classifier
    benefits `server-auth-actions` and the TanStack Start
    `get-mutation` rule ([#260](https://github.com/millionco/react-doctor/issues/260)).
  - `async-defer-await` no longer reports awaits inside destructured
    patterns with defaults, bare-statement early-returns, or awaits
    guarded by an earlier `if … return …` ([#265](https://github.com/millionco/react-doctor/issues/265)).
  - `js-length-check-first` detects length guards anywhere earlier in
    an `&&` chain, not only as the immediate left operand ([#269](https://github.com/millionco/react-doctor/issues/269)).
  - `async-parallel` is suppressed in test files, browser-fixture /
    Playwright helpers, and ordered UI flows where serial awaits are
    deliberate ([#270](https://github.com/millionco/react-doctor/issues/270)).
  - `js-combine-iterations` skips lazy `Iterator` helper chains
    (`Iterator.from`, `Iterator.prototype.{map,filter,take,drop,…}`)
    whose evaluation semantics differ from `Array.prototype` ([#272](https://github.com/millionco/react-doctor/issues/272),
    resolves [#205](https://github.com/millionco/react-doctor/issues/205)).
  - `no-prevent-default` is framework-aware: Remix / Next.js
    progressive-enhancement form handlers, synthetic event types with
    no documented alternative, and form `onSubmit` handlers that
    subsequently call `fetch` / a server action no longer trip ([#274](https://github.com/millionco/react-doctor/issues/274)).
  - New per-surface diagnostic controls in `@react-doctor/core` +
    `react-doctor`: design and Tailwind cleanup categories are demoted
    from the default PR-comment surface while staying visible in the
    CLI report and at the CI failure gate ([#271](https://github.com/millionco/react-doctor/issues/271)).

- [#284](https://github.com/millionco/react-doctor/pull/284) [`b34c5c4`](https://github.com/millionco/react-doctor/commit/b34c5c4db28539d9407fc08600e0e8c28dea67cd) - Harden glob pattern compilation against ReDoS:

  - Replace the hand-rolled glob-to-regex compiler with [`picomatch`](https://github.com/micromatch/picomatch), the proven matcher behind `chokidar`, `fast-glob`, and `micromatch`. The previous compiler turned patterns like `**/**/**/**/**/foo.tsx` into nested optional `(?:.+/)?` groups whose backtracking is exponential in the number of `**` segments - a 20-deep pattern hung for over 30 seconds on a 60-character non-matching input.
  - Reject obviously pathological patterns early with a clear `InvalidGlobPatternError` carrying the offending pattern and a human-readable reason, instead of crashing the scan. Limits live in `@react-doctor/core/constants` (`MAX_GLOB_PATTERN_LENGTH_CHARS = 1024`, `MAX_GLOB_PATTERN_WILDCARD_COUNT = 24`) and bound worst-case work regardless of the underlying engine. Real-world ignore patterns like `**/foo/**/bar/**/*.tsx` sit well under the cap.
  - Surface invalid `ignore.files` and `ignore.overrides[*].files` entries as `[react-doctor] …` warnings on stderr and skip just the bad pattern, so a single typo no longer takes the whole scan down.
  - Add regression tests covering the worst-case patterns (deeply-stacked globstars and dense `a*a*a*…` alternations) and the validation surface.

- [#266](https://github.com/millionco/react-doctor/pull/266) [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255) - Scope React Native rules to per-package boundaries. Previously every
  `rn-*` rule fired on every file in a project whose top-level framework
  was detected as React Native or Expo - even on sibling workspaces that
  were clearly web targets. In a mixed RN + web monorepo (`apps/mobile`
  alongside `apps/web` and `packages/storybook`) the rules would noisily
  report issues against Next.js, Vite, Docusaurus, Storybook, and plain
  React DOM packages where they don't apply.

  React Native rules now walk up to the file's nearest `package.json`
  before running. The rule body is skipped when the package declares a
  web-only framework (`next`, `vite`, `react-scripts`, `gatsby`,
  `@remix-run/react`, `@docusaurus/core`, `@storybook/*`, or plain
  `react-dom` without an RN sibling) and stays active when the package
  declares `react-native`, `expo`, `react-native-tvos`, `react-native-windows`,
  `react-native-macos`, anything under the `@react-native/` or
  `@react-native-` community namespaces (`@react-native-firebase/*`,
  `@react-native-async-storage/*`, `@react-native-community/*`, …), or
  Metro's top-level `"react-native"` resolution field.

  The detection is bidirectional: a web-rooted monorepo (root
  `package.json` declares `next` or `vite`) still loads `rn-*` rules
  when any workspace targets React Native or Expo, so the rules now
  fire on `apps/mobile` of a `next`-rooted repo as well as the inverse
  layout that the file-level boundary alone covered.

  `rn-no-raw-text` additionally skips raw text inside `Platform.OS === "web"`
  branches: `if`, `?:`, and `&&` / `||` short-circuits, the mirror
  `Platform.OS !== "web"` else branches, `switch (Platform.OS) { case "web": … }`
  case bodies, and the `web` arm of `Platform.select({ web: …, default: … })`.
  Optional chaining (`Platform?.OS`) and the TS non-null assertion
  (`Platform.OS!`) parse the same way as the bare form. The walker stops
  at function and `Program` boundaries so JSX defined inside a callback
  hoisted out of a `Platform.OS` branch does not inherit the parent
  guard.

  Native-only file extensions (`.ios.tsx`, `.android.tsx`, `.native.tsx`)
  keep the rule active even when the surrounding package classification
  is ambiguous.

- [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c) - False-positive sweep across the rule plugin and the oxlint runner:

  - Gate React-19-only rules on the detected React major version so they
    stay silent on React 18 projects, with hardened catalog / peer-range /
    workspace traversal in `@react-doctor/project-info` ([#254](https://github.com/millionco/react-doctor/issues/254)).
  - Treat early-return guards as render-reachable state reads so
    `rerender-state-only-in-handlers` / `no-event-trigger-state` stop
    recommending `useRef` for state that gates render output ([#255](https://github.com/millionco/react-doctor/issues/255)).
  - Narrow `no-effect-event-handler` - DOM imperatives, prop callbacks
    invoked from effects, and side effects routed through a stable ref
    are no longer reclassified as handler-only ([#256](https://github.com/millionco/react-doctor/issues/256)).
  - Suppress rules-of-hooks diagnostics on locally-defined `useX`
    helpers that are not React hooks, and add the `no-em-dash-in-jsx-text`
    / `no-three-period-ellipsis` typography rules ([#257](https://github.com/millionco/react-doctor/issues/257)).
  - Collapse duplicate oxlint diagnostics and recover diagnostics from
    large monorepo projects via batched runs + a new
    `dedupe-diagnostics` helper in `@react-doctor/core` ([#262](https://github.com/millionco/react-doctor/issues/262)).

- Updated dependencies [[`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255), [`5be2ead`](https://github.com/millionco/react-doctor/commit/5be2eadd90b2248b28b228fad306808cec1bf758), [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`809e38c`](https://github.com/millionco/react-doctor/commit/809e38cebabc15c42b3c40ee8c7a753c3d7549d0)]:
  - oxlint-plugin-react-doctor@0.2.0
  - @react-doctor/project-info@0.2.0
  - @react-doctor/types@0.2.0

## 0.2.0-beta.6

### Minor Changes

- Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

### Patch Changes

- [#284](https://github.com/millionco/react-doctor/pull/284) [`b34c5c4`](https://github.com/millionco/react-doctor/commit/b34c5c4db28539d9407fc08600e0e8c28dea67cd) - Harden glob pattern compilation against ReDoS:

  - Replace the hand-rolled glob-to-regex compiler with [`picomatch`](https://github.com/micromatch/picomatch), the proven matcher behind `chokidar`, `fast-glob`, and `micromatch`. The previous compiler turned patterns like `**/**/**/**/**/foo.tsx` into nested optional `(?:.+/)?` groups whose backtracking is exponential in the number of `**` segments - a 20-deep pattern hung for over 30 seconds on a 60-character non-matching input.
  - Reject obviously pathological patterns early with a clear `InvalidGlobPatternError` carrying the offending pattern and a human-readable reason, instead of crashing the scan. Limits live in `@react-doctor/core/constants` (`MAX_GLOB_PATTERN_LENGTH_CHARS = 1024`, `MAX_GLOB_PATTERN_WILDCARD_COUNT = 24`) and bound worst-case work regardless of the underlying engine. Real-world ignore patterns like `**/foo/**/bar/**/*.tsx` sit well under the cap.
  - Surface invalid `ignore.files` and `ignore.overrides[*].files` entries as `[react-doctor] …` warnings on stderr and skip just the bad pattern, so a single typo no longer takes the whole scan down.
  - Add regression tests covering the worst-case patterns (deeply-stacked globstars and dense `a*a*a*…` alternations) and the validation surface.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.6
  - @react-doctor/types@0.2.0-beta.6
  - @react-doctor/project-info@0.2.0-beta.6

## 0.2.0-beta.5

### Patch Changes

- [#252](https://github.com/millionco/react-doctor/pull/252) [`2d90c1c`](https://github.com/millionco/react-doctor/commit/2d90c1c5ae6d901913a575d40a784058478479ec) - Add public env-prefix detection (`get-public-env-prefix.ts`) and a
  recommendation builder (`build-no-secrets-recommendation.ts`) so
  client-secret diagnostics are scoped to actually client-reachable
  bindings instead of every string literal in the project.
  `run-oxlint.ts` and `runners/oxlint/config.ts` pass the detected
  prefix and the file-exposure classification through to the
  `no-secrets-in-client-code` rule.

- [#260](https://github.com/millionco/react-doctor/pull/260) [`b53d873`](https://github.com/millionco/react-doctor/commit/b53d8730459d2dc469a8f9841def231048c8de7e) - `run-oxlint.ts` + `runners/oxlint/config.ts` thread the new
  locally-scoped-safe-bindings classification through to the GET
  handler rule so `response.headers` and locally-constructed `Map` /
  `Set` / `Headers` no longer fail the Next.js GET-handler diagnostic.

- [#271](https://github.com/millionco/react-doctor/pull/271) [`7a7ec84`](https://github.com/millionco/react-doctor/commit/7a7ec84fad631d96f70279394be5f086b8424d17) - **Per-surface diagnostic filtering.** New public API:
  `diagnostic-surface.ts` (the `DiagnosticSurface` type - `pr-comment`,
  `cli`, `ci-failure-gate`), `filter-for-surface.ts` (filter a
  diagnostic list to those allowed on a given surface), and extended
  `validate-config-types.ts` with `surfaces.*` schema. Consumers can
  now demote whole categories (design, Tailwind cleanup) from default
  PR comments while keeping them visible in the CLI report and the
  CI gate. Exported from `packages/core/src/index.ts`.

- [#266](https://github.com/millionco/react-doctor/pull/266) [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255) - Scope React Native rules to per-package boundaries. Previously every
  `rn-*` rule fired on every file in a project whose top-level framework
  was detected as React Native or Expo - even on sibling workspaces that
  were clearly web targets. In a mixed RN + web monorepo (`apps/mobile`
  alongside `apps/web` and `packages/storybook`) the rules would noisily
  report issues against Next.js, Vite, Docusaurus, Storybook, and plain
  React DOM packages where they don't apply.

  React Native rules now walk up to the file's nearest `package.json`
  before running. The rule body is skipped when the package declares a
  web-only framework (`next`, `vite`, `react-scripts`, `gatsby`,
  `@remix-run/react`, `@docusaurus/core`, `@storybook/*`, or plain
  `react-dom` without an RN sibling) and stays active when the package
  declares `react-native`, `expo`, `react-native-tvos`, `react-native-windows`,
  `react-native-macos`, anything under the `@react-native/` or
  `@react-native-` community namespaces (`@react-native-firebase/*`,
  `@react-native-async-storage/*`, `@react-native-community/*`, …), or
  Metro's top-level `"react-native"` resolution field.

  The detection is bidirectional: a web-rooted monorepo (root
  `package.json` declares `next` or `vite`) still loads `rn-*` rules
  when any workspace targets React Native or Expo, so the rules now
  fire on `apps/mobile` of a `next`-rooted repo as well as the inverse
  layout that the file-level boundary alone covered.

  `rn-no-raw-text` additionally skips raw text inside `Platform.OS === "web"`
  branches: `if`, `?:`, and `&&` / `||` short-circuits, the mirror
  `Platform.OS !== "web"` else branches, `switch (Platform.OS) { case "web": … }`
  case bodies, and the `web` arm of `Platform.select({ web: …, default: … })`.
  Optional chaining (`Platform?.OS`) and the TS non-null assertion
  (`Platform.OS!`) parse the same way as the bare form. The walker stops
  at function and `Program` boundaries so JSX defined inside a callback
  hoisted out of a `Platform.OS` branch does not inherit the parent
  guard.

  Native-only file extensions (`.ios.tsx`, `.android.tsx`, `.native.tsx`)
  keep the rule active even when the surrounding package classification
  is ambiguous.

- Updated dependencies [[`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255)]:
  - oxlint-plugin-react-doctor@0.2.0-beta.5
  - @react-doctor/project-info@0.2.0-beta.3
  - @react-doctor/types@0.2.0-beta.3

## 0.2.0-beta.4

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- [#249](https://github.com/millionco/react-doctor/pull/249) [`f0198e2`](https://github.com/millionco/react-doctor/commit/f0198e2f2d9560a15bdb4a78f4a378ca2ac5fcdd) - **New public package.** Extracted from the `react-doctor` monolith
  in [#249](https://github.com/millionco/react-doctor/pull/249).
  Public surface: the oxlint runner family
  (`runners/oxlint/{config,capabilities,resolve-use-call-binding}.ts`,
  `run-oxlint`, `apply-ignore-overrides`, `batch-include-paths`),
  scoring (`calculate-score`), config validation
  (`validate-config-types`, `can-oxlint-extend-config`), diagnostic
  combination / dedupe / JSON reports (`combine-diagnostics`,
  `dedupe-diagnostics`, `build-json-report`,
  `build-json-report-error`), and the
  `check-reduced-motion` / `collect-ignore-patterns` /
  `list-source-files` helpers. Consumers that previously reached into
  `react-doctor/src/utils/*` should switch to importing from
  `@react-doctor/core`.

### Patch Changes

- [#208](https://github.com/millionco/react-doctor/pull/208) [`8556b31`](https://github.com/millionco/react-doctor/commit/8556b31d8e4e165f791db0aa60a6b038b18ec777) - **User-feedback sweep.** Surface each rule's contribution to the
  project score via the new scoring transparency hooks, accept
  per-rule severity overrides, and accept a `ruleSet` selector from
  config - all without changing the public `diagnose()` signature.

- [#254](https://github.com/millionco/react-doctor/pull/254) [`bfaf9c9`](https://github.com/millionco/react-doctor/commit/bfaf9c9530a9f8761df6e2d69abcf44c1699ff77) - `runners/oxlint/capabilities.ts` now consults the detected React
  major version when deciding which capability flags to enable. The
  React-19-only rule families are switched off on React 18 projects
  so the runner stops emitting rules the project can't act on.

- [#257](https://github.com/millionco/react-doctor/pull/257) [`ffbd20f`](https://github.com/millionco/react-doctor/commit/ffbd20f3d0ebda2221d2ea93f87342165da90fdb) - Adds `runners/oxlint/resolve-use-call-binding.ts` (619 LOC binding
  resolver) and `runners/oxlint/should-suppress-local-use-hook-diagnostic.ts`
  so the runner can post-filter rules-of-hooks diagnostics that point
  at locally-defined `useX` helpers (not actually React hooks).

- [#262](https://github.com/millionco/react-doctor/pull/262) [`bca5d30`](https://github.com/millionco/react-doctor/commit/bca5d30fc549a16c4628001dcd2c5a83e85c04f8) - Eval-driven oxlint robustness pass. `run-oxlint.ts` now batches
  include paths via the new `list-source-files` helper instead of
  globbing the universe, `utils/dedupe-diagnostics.ts` collapses
  duplicate diagnostics emitted across batched runs, and the runner
  recovers diagnostics from large monorepo projects that previously
  silently dropped output. Backed by `dedupe-diagnostics.test.ts`,
  `oxlint-batching.test.ts`, and `build-json-report.test.ts`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.2
  - @react-doctor/project-info@0.2.0-beta.2
  - @react-doctor/types@0.2.0-beta.2
