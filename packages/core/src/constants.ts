// SOURCE_FILE_PATTERN, GIT_LS_FILES_MAX_BUFFER_BYTES, and
// IGNORED_DIRECTORIES live in `./project-info/constants.js`
// (the project-discovery subtree). Re-exported here so core
// consumers don't have to know which subtree owns each constant.
export {
  GENERATED_BUNDLE_FILE_PATTERN,
  GIT_LS_FILES_MAX_BUFFER_BYTES,
  IGNORED_DIRECTORIES,
  MINIFIED_AVG_LINE_LENGTH_CHARS,
  MINIFIED_MAX_LINE_LENGTH_CHARS,
  MINIFIED_MIN_SIZE_BYTES,
  MINIFIED_SNIFF_BYTES,
  SOURCE_FILE_PATTERN,
} from "./project-info/constants.js";

export const JSX_FILE_PATTERN = /\.(tsx|jsx)$/;

// Whether `"warning"`-severity diagnostics surface when neither the
// caller (`--warnings` / `warnings:`) nor `config.warnings` decide.
// Warnings show by default — only `"error"` is too generous a bar for a
// health scan; users opt out with `--no-warnings` or `"warnings": false`.
export const DEFAULT_SHOW_WARNINGS = true;

export const MILLISECONDS_PER_SECOND = 1000;

// Upper bound for the `react:<major>` capability loop in
// `buildCapabilities`, clamping an unvalidated package.json spec like
// `"react": "20240101"` that would otherwise drive the loop to tens of
// millions of iterations (hang / OOM). Set generously — React ships
// ~one major a year and is probably only gonna be around for another
// 10 yrs, so 30 is plenty of headroom; any unused `react:<n>` capability
// strings above the latest real major are harmless.
export const LATEST_KNOWN_REACT_MAJOR = 30;

// Lowest React major react-doctor emits a `react:<major>` capability
// for (rules gate on `react:17`+ at the floor).
export const EARLIEST_GATED_REACT_MAJOR = 17;

// Preact mirror of `LATEST_KNOWN_REACT_MAJOR`. Preact ships majors slowly
// (X/10 since 2019, 11 next), so 20 is ample headroom; surplus
// `preact:<n>` capability strings above the latest real major are harmless.
export const LATEST_KNOWN_PREACT_MAJOR = 20;

// Lowest Preact major react-doctor emits a `preact:<major>` capability
// for. Preact X (10) is the modern baseline.
export const EARLIEST_GATED_PREACT_MAJOR = 10;

export const ERROR_PREVIEW_LENGTH_CHARS = 200;

// Minimum length for the generic high-entropy token sweep in
// `redactSensitiveText`. Real API keys / tokens run 32+ chars; the
// known-format detectors catch shorter prefixed credentials, so this
// floor keeps the catch-all from masking ordinary long identifiers.
export const GENERIC_SECRET_MIN_LENGTH_CHARS = 32;

// Minimum Shannon entropy (bits/char) a long token must clear before the
// generic sweep in `redactSensitiveText` masks it. Random base64url/hex
// credentials sit ~4–6 bits/char; repetitive or word-like identifiers
// (e.g. `componentDisplayName2`, `aaaa…a1`) fall well below this, so the
// floor keeps the catch-all from masking ordinary long identifiers while
// still catching unknown-format secrets. 3.0 mirrors detect-secrets'
// hex-string threshold — low enough to avoid leaks, high enough to spare
// degenerate low-entropy strings.
export const GENERIC_SECRET_MIN_ENTROPY_BITS = 3.0;

export const PERFECT_SCORE = 100;

export const SCORE_GOOD_THRESHOLD = 75;

export const SCORE_OK_THRESHOLD = 50;

export const SCORE_BAR_WIDTH_CHARS = 50;

export const SCORE_API_URL = "https://www.react.doctor/api/score";

export const ENTERPRISE_CONTACT_URL = "https://react.doctor/enterprise";

export const SHARE_BASE_URL = "https://react.doctor/share";

// Guide for adding React Doctor to CI (GitHub Actions). The post-scan
// handoff prompt links here when offering the "Add to CI" setup, and the
// agent-handoff prompt points the agent here too.
export const CI_URL = "https://react.doctor/ci";

// Canonical GitHub Actions setup guide. The interactive "Add React Doctor to
// GitHub Actions?" prompt's "Read docs" choice opens this directly.
export const GITHUB_ACTIONS_SETUP_URL =
  "https://www.react.doctor/docs/ci-and-prs/github-actions-setup";

// Root of the documentation site. Guides for CI/CD setup, config files (to
// suppress rules), and diff/PR scanning live under it; the CLI links here
// from its closing "learn more" note.
export const DOCS_URL = "https://react.doctor/docs";

// Base URL for the per-rule documentation pages. The canonical,
// human-readable fix recipe for one rule lives at `<base>/<plugin>/<rule>`
// (see `buildRuleDocsUrl`) — the CLI links here from its fix-recipe
// directive. The raw `.md` prompts the `/doctor` playbook fetches on demand
// live under `https://www.react.doctor/prompts/rules/<plugin>/<rule>.md`.
export const DOCS_RULES_BASE_URL = `${DOCS_URL}/rules`;

// Canonical JSON Schema for `doctor.config.json`. Stamped as the
// `$schema` field when the rule-config CLI creates a config file so
// editors get autocomplete + hover docs (matches the README guidance).
export const CONFIG_SCHEMA_URL = "https://react.doctor/schema/config.json";

export const FETCH_TIMEOUT_MS = 10_000;

export const GITHUB_VIEWER_PERMISSION_TIMEOUT_MS = 2_000;

// HACK: Windows CreateProcessW limits total command-line length to 32,767 chars.
// Use a conservative threshold to leave room for the executable path and quoting overhead.
export const SPAWN_ARGS_MAX_LENGTH_CHARS = 24_000;

// HACK: bound per-batch work so that JS-evaluated plugins with bad
// scaling (originally the upstream `effect` plugin — verified to hit
// the 5-min spawn timeout on supabase/studio's ~3500 source files at
// batch=500, productive at batch=100; same characteristics apply to
// the ported `react-doctor/no-derived-state` family because both rely
// on whole-component scope walking) stay tractable AND so that oxlint
// doesn't SIGABRT from memory pressure on very large file sets.
// Smaller batches add ~50ms spawn overhead per extra batch — negligible
// vs the hard-cap perf cliffs they prevent.
export const OXLINT_MAX_FILES_PER_BATCH = 100;

// Bounds for the lint worker count (the `OxlintConcurrency` Reference, seeded
// by the `REACT_DOCTOR_PARALLEL` env var; the CLI's `--no-parallel` flag forces
// the MIN end). React Doctor's rules are oxlint JS plugins — single-threaded
// per process — so
// running the file batches across N concurrent oxlint subprocesses scales the
// scan nearly linearly with N. MAX bounds peak memory (each worker holds its
// batch's ASTs); the resolved count is clamped to [MIN, MAX].
export const MIN_SCAN_CONCURRENCY = 1;

export const MAX_SCAN_CONCURRENCY = 16;

// Default worker count for a `diagnose({ projects })` batch. Each project
// scan already fans out its own oxlint workers (bounded by the constants
// above), so batch concurrency multiplies process count — a small bound
// keeps an 80-module monorepo from spawning hundreds of subprocesses by
// default. Callers opt into more via `DiagnoseProjectsInput.concurrency`.
export const DEFAULT_PROJECT_SCAN_CONCURRENCY = 4;

export const DEFAULT_BRANCH_CANDIDATES = ["main", "master"];

// JSON-format oxlint / eslint configs react-doctor can fold into the
// scan via oxlint's `extends` field. JS / TS configs need a runtime
// to evaluate and aren't supported by oxlint's `extends`. Listed in
// detection priority order — oxlint native first, eslint legacy as a
// compatibility fallback. Also used by tests as the source of truth.
export const ADOPTABLE_LINT_CONFIG_FILENAMES = [".oxlintrc.json", ".eslintrc.json"];

export const OXLINT_NODE_REQUIREMENT = "^20.19.0 || >=22.12.0";

export const OXLINT_RECOMMENDED_NODE_MAJOR = 24;

export const GIT_SHOW_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export const TSCONFIG_EXTENDS_MAX_DEPTH = 8;

export const ES2023_YEAR = 2023;

export const UNKNOWN_FUTURE_ES_YEAR = 9999;

export const ES_TARGET_YEAR_BY_NAME: Readonly<Record<string, number>> = {
  es3: 1999,
  es5: 2009,
  es6: 2015,
  es2015: 2015,
  es2016: 2016,
  es2017: 2017,
  es2018: 2018,
  es2019: 2019,
  es2020: 2020,
  es2021: 2021,
  es2022: 2022,
  es2023: 2023,
  es2024: 2024,
  es2025: 2025,
  esnext: UNKNOWN_FUTURE_ES_YEAR,
};

/**
 * Project-config files that `StagedFiles.materialize` copies into
 * the temp directory alongside staged sources so oxlint resolves
 * `tsconfig` / `package.json` / lint configs the same way it would
 * in the working tree. Hoisted out of the staged-files helper so
 * the constant lives next to the rest of the IO budget knobs.
 */
export const STAGED_FILES_PROJECT_CONFIG_FILENAMES = [
  "tsconfig.json",
  "tsconfig.base.json",
  "package.json",
  "doctor.config.ts",
  "doctor.config.mts",
  "doctor.config.cts",
  "doctor.config.js",
  "doctor.config.mjs",
  "doctor.config.cjs",
  "doctor.config.json",
  "doctor.config.jsonc",
  "oxlint.json",
  ".oxlintrc.json",
] as const;

export const CONFIG_FINGERPRINT_FILENAMES = [
  "doctor.config.ts",
  "doctor.config.mts",
  "doctor.config.cts",
  "doctor.config.js",
  "doctor.config.mjs",
  "doctor.config.cjs",
  "doctor.config.json",
  "doctor.config.jsonc",
  "react-doctor.config.json",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  ".oxlintrc.json",
  ".eslintrc.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ".gitignore",
] as const;

export const CANONICAL_GITHUB_URL = "https://github.com/millionco/react-doctor";

export const CANONICAL_DISCORD_URL = "https://react.doctor/discord";

export const SKILL_NAME = "react-doctor";

// HACK: cap on combined stdout+stderr bytes per oxlint batch. Above
// this we kill the process (SIGKILL) and ask the user to narrow the
// scan with --diff. Pinned to 50 MiB because oxlint emits ~1 KB of
// JSON per diagnostic and the largest real-world batches in the eval
// corpus (supabase/studio at 3,567 source files) produce ~3 MiB
// total — 50 MiB leaves an order of magnitude of headroom for
// pathological JS-plugin rules that emit one diagnostic per AST node.
export const OXLINT_OUTPUT_MAX_BYTES = 50 * 1024 * 1024;

// HACK: per-batch wall-clock budget for an oxlint spawn. Each batch
// is at most OXLINT_MAX_FILES_PER_BATCH (= 100) files and a healthy
// batch finishes in well under a second; 60 s leaves a large safety
// margin while still firing fast enough that the binary-split
// recovery in spawnLintBatches narrows a pathological batch to the
// single offending file rather than killing the whole scan as the
// previous 5-min budget did on supabase/studio. The eval harness
// overrides this via the OxlintSpawnTimeoutMs Context.Reference when
// running under Vercel Sandbox microVMs where the oxlint native
// binding is markedly slower than on a developer laptop.
export const OXLINT_SPAWN_TIMEOUT_MS = 60_000;

export const DEAD_CODE_WORKER_TIMEOUT_MS = 120_000;

// deslop's semantic pass builds a full TypeScript program and walks
// every identifier through the type checker. On type-heavy projects
// (large tRPC routers, Effect/Zod schemas, deep generics) the checker
// instantiates enormous types and the child can exceed Node's default
// ~4 GB heap, dying with an uncatchable "heap out of memory" — which
// surfaces as a silent "Scanning failed (dead-code analysis)". Raise
// the child's heap so those projects complete instead of crashing.
export const DEAD_CODE_WORKER_MAX_OLD_SPACE_MB = 8192;

// HACK: lookahead cap for JSX opener-span scanning; bounds worst-case
// work on pathological files. Real openers stay well under this.
export const JSX_OPENER_SCAN_MAX_LINES = 32;

// HACK: lookback cap for stacked / near-miss disable-next-line scanning.
// Larger gaps stop being intentional suppressions and become noise.
export const SUPPRESSION_NEAR_MISS_MAX_LINES = 10;

// In the default human output, show several category sections like an
// audit report, but cap each section so one noisy category does not
// bury the rest of the scan.
export const MAX_CATEGORY_GROUPS_SHOWN_NON_VERBOSE = 5;

export const MAX_RULE_GROUPS_PER_CATEGORY_NON_VERBOSE = 3;

// `minimumReleaseAge` in `pnpm-workspace.yaml` is denominated in
// minutes. 7 days × 24 h × 60 min = 10080. Surfaced as the
// recommended starting point for the supply-chain hardening check.
export const RECOMMENDED_PNPM_MINIMUM_RELEASE_AGE_MINUTES = 10_080;

// React's three Server Components transport packages (published in lockstep
// with `react`/`react-dom`). A framework, bundler, or bundler plugin that
// supports RSC pulls one of these in; an app that depends on none of them is
// not exposed to the RSC deserialization advisories. Used by the React Server
// Components security check to resolve the installed RSC runtime version.
export const REACT_SERVER_DOM_PACKAGES = [
  "react-server-dom-webpack",
  "react-server-dom-parcel",
  "react-server-dom-turbopack",
] as const;

// React's disclosure of the critical unauthenticated RSC RCE (CVE-2025-55182).
export const REACT_BLOG_RSC_ADVISORY_URL =
  "https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components";

// Vercel's coordinated Next.js + React security release with the per-version
// patched-release table the Next.js advisory check keys off.
export const VERCEL_NEXTJS_SECURITY_RELEASE_URL =
  "https://vercel.com/changelog/next-js-may-2026-security-release";

// The closed set of user-facing diagnostic categories. Every rule
// (collapsed at codegen via `CATEGORY_BUCKET` in
// `generate-rule-registry.mjs`) and every directly-constructed
// diagnostic (dead-code, reduced-motion, pnpm-hardening) must report one
// of these — the renderer, JSON output, and `categories` severity
// overrides all assume this set is exhaustive. `rule-metadata.test.ts`
// asserts the registry never drifts outside it.
export const DIAGNOSTIC_CATEGORY_BUCKETS = [
  "Security",
  "Bugs",
  "Performance",
  "Accessibility",
  "Maintainability",
] as const;

// Rules whose heuristic only makes sense in application code. A published
// library deliberately exposes flexible primitives (components built in
// render to capture closures, many `render*` slots for composition), so these
// fire on `app` / `unknown` files but stay silent on confidently-classified
// `library` files (see `classify-package-role.ts`). Users can still force one
// on for a library by setting its severity explicitly in config.
export const APP_ONLY_RULE_KEYS: ReadonlySet<string> = new Set([
  "react-hooks-js/static-components",
  "react-doctor/no-render-prop-children",
  "react-doctor/prefer-explicit-variants",
]);

// The `compiler-cleanup` severity bucket: redundant-memoization rules that
// only fire once React Compiler is detected and ship as warnings by default
// (hidden in the default report). Setting `buckets: { "compiler-cleanup":
// "error" }` re-enables full strictness.
//
// Only the local `react-compiler-no-manual-memoization` rule belongs here —
// it flags `useMemo` / `useCallback` / `memo` the compiler makes redundant
// (correctness-neutral cleanup). The external `react-hooks-js/*` compiler
// rules deliberately stay `error`: each marks code the compiler could NOT
// optimize, which is a real perf regression, not cleanup.
export const COMPILER_CLEANUP_BUCKET = "compiler-cleanup";
export const COMPILER_CLEANUP_RULE_KEYS: ReadonlySet<string> = new Set([
  "react-doctor/react-compiler-no-manual-memoization",
]);

// How many of the highest-priority error rules to surface in the
// "Top N errors you should fix" header above the category breakdown.
export const TOP_ERRORS_DISPLAY_COUNT = 3;

// Source-context window rendered around each top-error site in the
// inline code frame (lines above / below the offending line).
export const CODE_FRAME_LINES_ABOVE = 1;
export const CODE_FRAME_LINES_BELOW = 1;

// Skip rendering an inline code frame when the offending source line is
// longer than this — a single huge line (minified output, a giant inline
// data literal) only produces an unreadable wall of text in the terminal,
// so we fall back to the bare `file:line` reference instead.
export const CODE_FRAME_MAX_LINE_LENGTH_CHARS = 200;

// When one rule hits several sites in the same file, sites whose frames
// would overlap are merged into a single spanning frame instead of
// rendering near-duplicate boxes. Two sites merge when the gap between
// their lines is within this window (the frame's own context reach), and
// a merged frame never spans more offending lines than the max below — a
// long contiguous run is split into a few bounded frames rather than one
// giant wall.
export const CODE_FRAME_BATCH_MAX_SPAN_LINES = 20;

export const OUTPUT_DETAIL_WRAP_WIDTH_CHARS = 88;

// Typographic "measure" — the line length (in characters) we wrap
// prose explanations to for comfortable reading. Kept short (well under
// the terminal width) so multi-line blurbs stay easy to scan.
export const OUTPUT_MEASURE_WIDTH_CHARS = 60;

export const SPINNER_INDENT_CHARS = 0;

// Defense-in-depth caps for user-supplied glob patterns. Picomatch
// itself is well-hardened against many bad inputs, but ALL glob →
// JavaScript regex compilers emit backtracking-prone output when fed
// densely interleaved wildcards (e.g. `a*a*a*a*…`). These limits
// reject obviously pathological inputs with a clear config error
// before any matcher compilation, bounding worst-case work even when
// the underlying engine is robust. The wildcard cap intentionally
// leaves headroom for realistic ignore patterns
// (e.g. `**/foo/**/bar/**/baz/**/*.tsx` has 9 wildcards) while
// rejecting deeply-stacked globstars and dense alternations.
export const MAX_GLOB_PATTERN_LENGTH_CHARS = 1024;

export const MAX_GLOB_PATTERN_WILDCARD_COUNT = 24;

// `Config.layerNode` caches resolved configs per directory so the CLI's
// repeated `inspect()` calls (one per project in a monorepo loop) don't
// reload the same `react-doctor.config.json` each time. Capacity bounds
// memory on monorepos with hundreds of workspace packages; TTL handles
// long-running consumers (watch-mode tools, language servers).
export const CONFIG_CACHE_CAPACITY = 16;

export const CONFIG_CACHE_TTL_MS = 5 * 60 * 1_000;

/**
 * Max sample size shown in partial-failure preview text (e.g.
 * "and N more files: a.ts, b.ts, c.ts") emitted by the oxlint
 * binary-split-retry loop.
 */
export const OXLINT_PARTIAL_FAILURE_PREVIEW_COUNT = 3;

// HACK: interval for simulated per-file progress ticks while an oxlint
// batch subprocess runs. The timer increments a counter so the spinner
// updates smoothly instead of jumping by the batch size on completion.
export const PROGRESS_TICK_INTERVAL_MS = 50;

// Socket.dev package-score check (the `SupplyChain` service). Mirrors how
// Socket Firewall's free tier (`sfw`) talks to Socket: the keyless,
// no-API-token endpoint `GET <base>/{encodeURIComponent(purl)}`, where the
// PURL is `pkg:npm/<name>@<version>` (scope kept inline, e.g.
// `pkg:npm/@vue/reactivity@3.4.0`). The response is newline-delimited JSON,
// one Socket artifact per line, each carrying a `score` object with an
// `overall` plus per-category values in the 0..1 range. Unknown
// package/version pairs come back as a `synthetic:notFound:*` artifact with
// no `score`, which the check skips.
export const SOCKET_FREE_PURL_API_BASE = "https://firewall-api.socket.dev/purl";

// Public socket.dev package page, linked from each diagnostic's `help`/`url`
// so a developer can see the full alert + score breakdown for the version.
export const SOCKET_PACKAGE_PAGE_BASE = "https://socket.dev/npm/package";

// Sent as the `User-Agent` on the free score lookups, matching how `sfw`
// identifies itself to the same endpoint.
export const SOCKET_FREE_USER_AGENT = "react-doctor-supply-chain";

// Plugin / rule / category identity for the diagnostics the supply-chain
// check emits. `plugin: "socket"` keeps Socket findings visually distinct
// from the `react-doctor` lint surface in the printed list and JSON report.
export const SUPPLY_CHAIN_PLUGIN = "socket";
export const SUPPLY_CHAIN_RULE = "low-supply-chain-score";
export const SUPPLY_CHAIN_CATEGORY = "Security";

// Default minimum acceptable Socket score (0..100), applied to the security
// axes (supply chain, vulnerability) — a dependency whose worst security
// axis scores below this fails the check. Tuned to Socket's own "needs
// review" band — most healthy, widely-used packages sit comfortably above
// it. Overridable per project via `supplyChain.minScore`.
export const SUPPLY_CHAIN_DEFAULT_MIN_SCORE = 50;

// Socket scores arrive normalized 0..1; multiply by this to present the
// familiar 0..100 scale users see on socket.dev.
export const SOCKET_SCORE_SCALE = 100;

// How many free Socket score lookups to keep in flight at once. Bounded so a
// large dependency list doesn't open hundreds of sockets or trip Socket's
// per-route rate limit.
export const SUPPLY_CHAIN_FETCH_CONCURRENCY = 8;

// Packages excluded from the Socket supply-chain check (the gate and the
// `--sfw` listing). react-doctor already covers these frameworks' specific
// risks through dedicated rules — e.g. Next.js via the server-components /
// Next rule family — so a low Socket score would be redundant noise rather
// than an actionable, distinct supply-chain signal.
export const SUPPLY_CHAIN_IGNORED_PACKAGES: ReadonlySet<string> = new Set(["next"]);
