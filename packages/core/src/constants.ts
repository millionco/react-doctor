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

export const TYPESCRIPT_DECLARATION_FILE_PATTERN = /\.d\.(?:ts|mts|cts)$/;

// HACK: Oxlint 1.68 added ambient-context parser diagnostics that ignore
// projects' skipLibCheck setting. Preserve the existing report and score
// contract while keeping earlier TypeScript parser diagnostics visible.
export const OXLINT_IGNORED_DECLARATION_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  "TS(1036)",
  "TS(1038)",
  "TS(1183)",
  "TS(1319)",
]);

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

// Valtio shipped the useSnapshot render contract in v1. The upper bound
// follows the same untrusted-version clamp as React and Preact.
export const EARLIEST_GATED_VALTIO_MAJOR = 1;
export const EARLIEST_GATED_STYLED_COMPONENTS_MAJOR = 6;
export const LATEST_KNOWN_VALTIO_MAJOR = 10;
export const LATEST_KNOWN_REMOTION_MAJOR = 30;

export const EARLIEST_GATED_REMOTION_MAJOR = 4;

export const EARLIEST_GATED_MOBX_MAJOR = 4;

export const LATEST_SUPPORTED_MOBX_MAJOR = 6;
export const MOBX_ABORT_SIGNAL_MAJOR = 6;
export const MOBX_ABORT_SIGNAL_MINOR = 10;
export const MOBX_REACT_OBSERVER_MEMO_GUARD_MAJOR = 7;
export const MOBX_REACT_OBSERVER_MEMO_GUARD_MINOR = 3;
export const MOBX_REACT_LITE_OBSERVER_MEMO_GUARD_MAJOR = 3;
export const MOBX_REACT_LITE_OBSERVER_MEMO_GUARD_MINOR = 3;
export const EARLIEST_GATED_ZUSTAND_MAJOR = 1;

export const LATEST_SUPPORTED_ZUSTAND_MAJOR = 5;

export const LATEST_KNOWN_R3F_MAJOR = 10;

export const EARLIEST_GATED_R3F_MAJOR = 3;

export const EARLIEST_GATED_THREE_RELEASE = 145;

export const LATEST_KNOWN_THREE_RELEASE = 250;

export interface ReactRouterCapabilityThreshold {
  capability:
    | "react-router:6.4"
    | "react-router:6.7"
    | "react-router:6.9"
    | "react-router:6.19"
    | "react-router:7"
    | "react-router:7.8"
    | "react-router:7.9"
    | "react-router:7.10"
    | "react-router:7.15"
    | "react-router:8";
  major: number;
  minor: number;
}

export const REACT_ROUTER_CAPABILITY_THRESHOLDS: ReadonlyArray<ReactRouterCapabilityThreshold> = [
  { capability: "react-router:6.4", major: 6, minor: 4 },
  { capability: "react-router:6.7", major: 6, minor: 7 },
  { capability: "react-router:6.9", major: 6, minor: 9 },
  { capability: "react-router:6.19", major: 6, minor: 19 },
  { capability: "react-router:7", major: 7, minor: 0 },
  { capability: "react-router:7.8", major: 7, minor: 8 },
  { capability: "react-router:7.9", major: 7, minor: 9 },
  { capability: "react-router:7.10", major: 7, minor: 10 },
  { capability: "react-router:7.15", major: 7, minor: 15 },
  { capability: "react-router:8", major: 8, minor: 0 },
];

// Max chars of an unparseable oxlint stdout we keep for the error
// message. oxlint prints a multi-line, framed error to stdout when it
// can't load the config (e.g. a JS plugin failed to import) — the first
// useful line is the plugin path, the second the underlying
// `Error: …` reason. 200 chars truncated mid-path (landing on a bare
// `…/node_modules/`), which read as react-doctor passing an invalid
// directory and hid the real cause (issue #833). 600 keeps the path
// AND the reason line for realistic (deep pnpm) paths.
export const ERROR_PREVIEW_LENGTH_CHARS = 600;

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

// Linux argv limits are ~2 MB (ARG_MAX minus environment); a conservative cap
// below that keeps the pre-spawn guard meaningful without rejecting the
// legitimately long `git diff -- <hundreds of files>` invocations that
// `--scope lines` produces on large PRs.
export const SPAWN_ARGS_MAX_LENGTH_CHARS_POSIX = 1_500_000;

// macOS ARG_MAX is 1 MiB and covers argv AND envp together, so its cap sits
// well below that: an argv that passes the guard but crosses the real OS
// limit makes `spawn` throw `E2BIG` SYNCHRONOUSLY (Node routes only
// EACCES/EAGAIN/EMFILE/ENFILE/ENOENT through the catchable 'error' event),
// escaping Effect's failure channel — the exact crash class the guard
// exists to prevent (issue #924).
export const SPAWN_ARGS_MAX_LENGTH_CHARS_DARWIN = 800_000;

// Probe of the oxlint child Node's `--version` (the nvm fallback can run a
// different Node than this process), once per binary path per process.
export const NODE_VERSION_PROBE_TIMEOUT_MS = 5_000;

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

// Bounds for the lint worker count (the `OxlintConcurrency` Reference, seeded by
// the `REACT_DOCTOR_PARALLEL` env var; the CLI's `--no-parallel` flag forces the
// MIN end). React Doctor's rules are oxlint JS plugins — single-threaded per
// process — so running the file batches across N concurrent oxlint subprocesses
// scales the scan nearly linearly with N up to the straggler / per-spawn-overhead
// knee (~10 workers). `resolveAutoScanConcurrency` chooses N for the auto path;
// every requested count is clamped to [MIN, HARD_MAX].
export const MIN_SCAN_CONCURRENCY = 1;

// Absolute upper bound on lint workers, and the clamp applied to every requested
// count (auto-detected, `REACT_DOCTOR_PARALLEL=N`, or `inspect({ concurrency })`).
// Past ~10 workers parallel efficiency already collapses (stragglers + per-spawn
// overhead), so 32 is headroom that stops a 32/64-core CI runner from idling
// cores behind the old fixed 16 — not a promise of proportionally more speed.
export const HARD_MAX_SCAN_CONCURRENCY = 32;

// Memory one oxlint subprocess is budgeted at the OXLINT_MAX_FILES_PER_BATCH=100
// batch size (the native binding's parser arena + the batch's ASTs + the
// JS-plugin heap). The auto path takes `floor(availableMemory / this)` as a
// second ceiling alongside the core count, so a high-core / memory-starved box
// (or a memory-limited container) doesn't spawn enough workers to trip the
// native-binding SIGABRT that OXLINT_MAX_FILES_PER_BATCH and the EAGAIN/ENOMEM
// serial replay already guard. 1 GiB matches the per-worker footprint the old
// fixed-16 ceiling implicitly tolerated (16 workers on a typical 16 GiB CI box),
// so any machine with >= ~1 GiB/core stays core-bound and the memory term only
// binds on genuinely memory-constrained hosts — exactly where over-subscription
// would OOM. `availableMemory` is `os.totalmem()` floored by the cgroup memory
// limit, NOT `os.freemem()`, which excludes reclaimable page cache and reads
// near-zero on macOS / cache-heavy Linux, collapsing the auto path to one worker.
export const PER_WORKER_MEM_BUDGET_BYTES = 1024 * 1024 * 1024;

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

export const REACT_COMPILER_CONFIG_IMPORT_MAX_DEPTH = 4;

export const ES2023_YEAR = 2023;

export const UNKNOWN_FUTURE_ES_YEAR = 9999;

export interface TargetBlankBrowserSupport {
  browserName: string;
  supportsTargetBlankBrowsingContext: boolean;
  implicitNoopenerVersion: number | null;
  explicitNoopenerVersion: number | null;
  explicitNoreferrerVersion: number | null;
}

export const TARGET_BLANK_BROWSER_SUPPORT: ReadonlyArray<TargetBlankBrowserSupport> = [
  {
    browserName: "chrome",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 16,
    explicitNoopenerVersion: 49,
    implicitNoopenerVersion: 88,
  },
  {
    browserName: "and_chr",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 16,
    explicitNoopenerVersion: 49,
    implicitNoopenerVersion: 88,
  },
  {
    browserName: "android",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 2.3,
    explicitNoopenerVersion: 49,
    implicitNoopenerVersion: 88,
  },
  {
    browserName: "edge",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 13,
    explicitNoopenerVersion: 79,
    implicitNoopenerVersion: 88,
  },
  {
    browserName: "firefox",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 33,
    explicitNoopenerVersion: 52,
    implicitNoopenerVersion: 79,
  },
  {
    browserName: "and_ff",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 33,
    explicitNoopenerVersion: 52,
    implicitNoopenerVersion: 79,
  },
  {
    browserName: "kaios",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 2.5,
    explicitNoopenerVersion: 3,
    implicitNoopenerVersion: 3,
  },
  {
    browserName: "safari",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 5,
    explicitNoopenerVersion: 10.1,
    implicitNoopenerVersion: 12.1,
  },
  {
    browserName: "ios_saf",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 4,
    explicitNoopenerVersion: 10.3,
    implicitNoopenerVersion: 12.2,
  },
  {
    browserName: "opera",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 15,
    explicitNoopenerVersion: 36,
    implicitNoopenerVersion: 74,
  },
  {
    browserName: "op_mob",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 80,
    explicitNoopenerVersion: 80,
    implicitNoopenerVersion: 80,
  },
  {
    browserName: "op_mini",
    supportsTargetBlankBrowsingContext: false,
    explicitNoreferrerVersion: null,
    explicitNoopenerVersion: null,
    implicitNoopenerVersion: null,
  },
  {
    browserName: "samsung",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 4,
    explicitNoopenerVersion: 5,
    implicitNoopenerVersion: 15,
  },
  {
    browserName: "and_uc",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 15.5,
    explicitNoopenerVersion: 15.5,
    implicitNoopenerVersion: null,
  },
  {
    browserName: "and_qq",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 14.9,
    explicitNoopenerVersion: 14.9,
    implicitNoopenerVersion: null,
  },
  {
    browserName: "baidu",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: 13.52,
    explicitNoopenerVersion: 13.52,
    implicitNoopenerVersion: null,
  },
  {
    browserName: "ie",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: null,
    explicitNoopenerVersion: null,
    implicitNoopenerVersion: null,
  },
  {
    browserName: "ie_mob",
    supportsTargetBlankBrowsingContext: true,
    explicitNoreferrerVersion: null,
    explicitNoopenerVersion: null,
    implicitNoopenerVersion: null,
  },
];

export const ELECTRON_EXPLICIT_NOOPENER_MIN_VERSION = "0.37.0";

export const ELECTRON_IMPLICIT_NOOPENER_MIN_VERSION = "12.0.0";

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
 * tsconfig filenames probed when resolving a project's TypeScript
 * compiler options — the root config first, then a monorepo base config.
 */
export const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.base.json"] as const;

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

// Longest synchronous burst a cooperative main-thread pass (the security
// scan's walk / file / rule steps, lint's pre-spawn cache hashing) may hold
// the event loop before handing it back. Lint child processes are spawned and
// drained from main-thread continuations, so bursts beyond ~a frame idle the
// whole worker pool — and starve concurrently-scanning sibling projects.
export const COOPERATIVE_YIELD_BUDGET_MS = 12;

// Directory name appended to os.tmpdir() to form the shared base for the V8
// compile cache. Matches the base Node's own module.enableCompileCache() uses,
// so the bin (parent) and the spawned oxlint batches (children) share one tree.
export const NODE_COMPILE_CACHE_DIR_NAME = "node-compile-cache";

export const DEAD_CODE_WORKER_TIMEOUT_MS = 120_000;

// Cumulative wall-clock budget across ALL binary-split retries of one
// batch pass. A pathological file recurses through ~log2(100)≈7
// split levels, and each level re-waits a full OXLINT_SPAWN_TIMEOUT_MS;
// without a cumulative cap that cascade can stall the scan for minutes.
// 180 s bounds the whole cascade while leaving room for a few healthy
// re-spawns at the upper levels.
export const OXLINT_SPLIT_TOTAL_BUDGET_MS = 180_000;

// Recursion-depth cap on the binary-split recovery — a belt to the
// OXLINT_SPLIT_TOTAL_BUDGET_MS suspenders. A 100-file batch needs at
// most ceil(log2(100))=7 levels to isolate a single offender; 8 leaves
// one level of slack and still terminates the recursion deterministically
// even if the budget clock is somehow not advancing.
export const OXLINT_SPLIT_MAX_DEPTH = 8;

// Exit codes that mean the oxlint child ABORTED rather than exited. Windows
// has no POSIX signals, so an aborting child (oxlint's native binding
// panicking under memory pressure, or Node's own `process.abort()`) reports
// `signal: null` plus one of these exit codes instead of the SIGABRT a POSIX
// parent would see: Node normalizes its aborts to 134 (`ExitCode::kAbort` —
// which is also the POSIX 128+SIGABRT convention), and a Rust / `__fastfail`
// abort exits with NTSTATUS STATUS_STACK_BUFFER_OVERRUN (0xC0000409).
// `spawnOxlint` folds these into the same `OxlintBatchExceeded
// { kind: "oom" }` class as a SIGABRT so the binary-split retry and the OOM
// rescue pass work on Windows too.
export const ABORT_EXIT_CODES: ReadonlySet<number> = new Set([134, 0xc0000409]);

// Wall-clock cap on the serial OOM rescue pass (replaying OOM-dropped
// files one at a time after the parallel pass). The rescue is unbounded
// by batch count — each file that STILL fails re-waits a spawn timeout —
// so without a cap a large OOM-dropped set could eat the whole
// LINT_PHASE_TIMEOUT_MS and convert a partial scan into a total lint
// failure. 60 s rescues dozens of healthy files while at most one
// still-pathological file can burn the budget.
export const OXLINT_OOM_RESCUE_BUDGET_MS = 60_000;

// Effect-side cap on the dead-code phase. Sits ABOVE the in-worker
// DEAD_CODE_WORKER_TIMEOUT_MS (= 120 s) as a runtime-independent
// backstop: if the worker's own timer is wedged (or the worker never
// reports back), the Effect timeout still reclaims the phase.
export const DEAD_CODE_PHASE_TIMEOUT_MS = 150_000;

// Effect-side cap on the lint phase. Sits ABOVE the worst bounded split
// cascade (OXLINT_SPLIT_TOTAL_BUDGET_MS plus scheduling overhead across
// parallel workers) so a healthy-but-slow large repo finishes while a
// truly wedged lint phase is still reclaimed. The split budget is scoped
// PER top-level batch, so several failing batches can stagger past one
// budget's worth of wall-clock — this cap is the hard ceiling that reclaims
// those pathological scans.
export const LINT_PHASE_TIMEOUT_MS = 300_000;

// Overall scan deadline backstop. Catches everything the per-phase
// timeouts don't bound — a wedged git invocation, a stuck filesystem
// read, scoring — so no single scan can run unbounded. Sits comfortably
// ABOVE the sum of the per-phase caps (supply-chain 90s + lint 5min +
// dead-code 2.5min = 9min, run sequentially) plus discovery / git /
// scoring overhead, so a scan that legitimately uses those budgets
// degrades gracefully via the per-phase skips instead of hard-failing on
// this deadline; only a genuinely wedged unbounded phase reaches it.
export const SCAN_TOTAL_DEADLINE_MS = 900_000;

// deslop's semantic pass builds a full TypeScript program and walks
// every identifier through the type checker. On type-heavy projects
// (large tRPC routers, Effect/Zod schemas, deep generics) the checker
// instantiates enormous types and the child can exceed Node's default
// ~4 GB heap, dying with an uncatchable "heap out of memory" — which
// surfaces as a silent "Scanning failed (dead-code analysis)". Raise
// the child's heap so those projects complete instead of crashing.
export const DEAD_CODE_WORKER_MAX_OLD_SPACE_MB = 8192;

// Memory budgeted per concurrent dead-code worker when sizing the global
// `withDeadCodeWorkerSlot` semaphore (`resolveDeadCodeConcurrency`). Deliberately
// well below the worker's `--max-old-space-size` ceiling above (that's a crash
// guard, not steady-state use): a deslop graph on a few-hundred-file project
// peaks around 1–1.5 GB, so 2 GB leaves headroom while still collapsing the
// concurrency toward 1 on a small CI runner — capping how many 8 GB-ceiling
// children a multi-project scan starts at once.
export const DEAD_CODE_WORKER_MEM_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;

// Dead-code timeout scales with the work. deslop is CPU-bound and roughly
// linear in source-file count, so a single fixed timeout is at once too
// generous for a small repo and too tight for a large one — on a multi-thousand
// file repo the graph build legitimately approaches the old fixed 120s cap, so
// any contention (a still-running supply-chain pass, an overlapped lint pool)
// tips it over and the findings are silently dropped. The worker timeout is
// `max(DEAD_CODE_WORKER_TIMEOUT_MS floor, fileCount * this)` capped at the
// ceiling; the phase timeout sits a margin above it.
export const DEAD_CODE_TIMEOUT_MS_PER_SOURCE_FILE = 30;
export const DEAD_CODE_TIMEOUT_CEILING_MS = 600_000;
export const DEAD_CODE_PHASE_TIMEOUT_OVER_WORKER_MS = 30_000;

// When dead-code is explicitly overlapped with lint (`DeadCodeOverlap="on"`),
// the two CPU-bound worker pools must SHARE the cores rather than each claiming
// all of them — uncoordinated, deslop's parse pool (`os.availableParallelism()`)
// and the oxlint pool (one child per core) sum to ~2x the cores and thrash,
// starving the parse pass past its timeout. The dead-code parse pool gets this
// fraction of the scan's worker budget and lint gets the rest, so the two sum to
// the budget instead of doubling it. (Overlap is OFF by default: dead-code is
// CPU-bound, so a sequential full-core pass is both faster per-phase and never
// oversubscribes — overlapping it with lint buys no wall-clock and only risks
// the starvation. This split exists for operators who force overlap on.)
export const DEAD_CODE_OVERLAP_PARSE_SHARE = 0.4;
export const MIN_DEAD_CODE_PARSE_CONCURRENCY = 1;

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

// Categories whose findings are matched by occurrence in the CI baseline
// delta — the finding's identity is the flagged element (a missing
// attribute, a wrong element), not the flagged line's text — so the delta
// may match them by same-file `(rule, message)` occurrence count after strict
// evidence matching. Every Accessibility rule is element-level; rules in other
// categories opt in individually via their per-rule `matchByOccurrence`
// flag (see `resolveMatchByOccurrence` in `runners/oxlint/parse-output`).
export const OCCURRENCE_MATCHED_CATEGORIES: ReadonlySet<string> = new Set(["Accessibility"]);

export const CATEGORY_IMPACT = {
  Security: "An attacker can read user data, act as your users, or run code you never shipped.",
  Bugs: "Real users hit crashes, wrong output, or state that silently corrupts.",
  Performance: "Users feel extra latency and wasted renders on every interaction.",
  Accessibility: "Users on screen readers, keyboards, or assistive tech get locked out.",
  Maintainability: "Every future change gets slower and riskier to make.",
} satisfies Record<(typeof DIAGNOSTIC_CATEGORY_BUCKETS)[number], string>;

const CATEGORY_IMPACT_BY_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(CATEGORY_IMPACT),
);

export const getCategoryImpact = (category: string): string | undefined =>
  CATEGORY_IMPACT_BY_NAME.get(category);

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

// Rules whose repeated findings in one file collapse to a single root-cause
// fix, so presentation + consumer surfaces can count them as one task instead
// of N (the state-on-prop-change family: several `useEffect`s deriving,
// adjusting, or resetting state when a prop changes all clear with one
// structural fix — a `key` prop or computing during render). `assignFixGroups`
// stamps a shared `fixGroupId` on same-(file, rule, message) findings of these
// rules. The allowlist is the safeguard: for an arbitrary rule the same message
// can mean genuinely separate fixes (a missing `key` on three different
// `.map()`s), so only rules where "same message ⇒ same fix" opt in here. Rules
// whose message interpolates a per-site name (`no-derived-state` etc.) stay
// listed but naturally only group the sites that share the exact message.
export const ROOT_CAUSE_GROUPABLE_RULE_KEYS: ReadonlySet<string> = new Set([
  "react-doctor/no-derived-state",
  "react-doctor/no-derived-state-effect",
  "react-doctor/no-derived-useState",
  "react-doctor/no-adjust-state-on-prop-change",
  "react-doctor/no-reset-all-state-on-prop-change",
]);

// Minimum findings that must share a root cause before they form a fix group:
// a lone finding is already its own task, so it never gets a `fixGroupId`.
export const MIN_SHARED_FIX_SITE_COUNT = 2;

// Length of the hex `fixGroupId` slice (sha1 of file + rule + message). Long
// enough to avoid collisions within one report, short enough to stay readable
// in the JSON output.
export const FIX_GROUP_ID_LENGTH_CHARS = 16;

// How many of the highest-priority error rules to surface in the
// "Top N errors you should fix" header above the category breakdown.
export const TOP_ERRORS_DISPLAY_COUNT = 3;

// A single rule firing across this many distinct files is a migration, not a
// quick fix: a mechanical sweep this wide is hard to review and easy to get
// subtly wrong everywhere at once, so it warrants a sampled, owner-approved
// rollout rather than a blind fix-all. Set above a normal review-sized PR
// (the agent playbook caps a fix bucket near ~30 files) so the advisory means
// "more than one PR's worth" and stays rare on ordinary repos. Files — not raw
// site count — gauge the review burden, so the gate keys on a rule's blast
// radius. Calibrate against the `migration.largestRuleBucketFiles` wide-event
// attribute.
export const MIGRATION_SCALE_RULE_FILE_COUNT = 40;

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

// Per-file lint cache (`runners/oxlint/file-lint-cache.ts`). Caches the raw
// oxlint diagnostics of unchanged files keyed by content hash + ruleset hash,
// so repeat scans re-lint only the files that actually changed.
// Bumped to 2 when declaration-file parser diagnostic compatibility filtering
// changed the stored diagnostic set.
export const FILE_LINT_CACHE_SCHEMA_VERSION = 2;

export const FILE_LINT_CACHE_FILENAME = "file-lint-cache.json";

// Number of distinct ruleset buckets kept in one cache file. Each toolchain /
// config change mints a new ruleset hash; older buckets are pruned LRU so the
// file can't grow without bound across upgrades.
export const FILE_LINT_CACHE_MAX_RULESET_COUNT = 8;

// Per-ruleset ceiling on cached files. Bounds memory + disk on very large
// repos; the most-recently-stored entries are kept when over the cap.
export const FILE_LINT_CACHE_MAX_FILE_COUNT = 50_000;

// Sidecar lint cache (`runners/oxlint/sidecar-lint-cache.ts`). Caches the
// cross-file rules' per-file diagnostics keyed by content hash + sidecar
// ruleset hash, each entry guarded by the file's cross-file dependency probe
// set, so a warm rescan replays the sidecar instead of re-linting every
// unchanged file. Shares the file cache's bucket/file caps.
// Bumped to 3 with the same parser-diagnostic compatibility change.
export const SIDECAR_LINT_CACHE_SCHEMA_VERSION = 3;

export const SIDECAR_LINT_CACHE_FILENAME = "sidecar-lint-cache.json";

// Length (chars) of the project-directory hash used to name the tmp-dir cache
// fallback when a project has no `node_modules` to host `.cache/react-doctor`.
export const CACHE_FILENAME_HASH_LENGTH_CHARS = 16;

// Length (chars) of the rule-plugin entry-content hash folded into the
// per-file lint cache's ruleset hash, so a rebuilt dev plugin (same version,
// different rule behavior) busts the cache instead of replaying stale
// diagnostics.
export const PLUGIN_FINGERPRINT_LENGTH_CHARS = 16;

// This package's own version, inlined at build time (`vite.config.ts` `env`)
// the same way the CLI inlines `VERSION`; running from source (tests, dev)
// falls back to "0.0.0". Cache keys include it because cached diagnostics
// carry core's POST-PROCESSING (message text, toolchain-dependency filtering),
// so an upgrade must never replay entries shaped by an older core.
export const CORE_PACKAGE_VERSION = process.env.REACT_DOCTOR_CORE_VERSION ?? "0.0.0";

// Whole-project dead-code result cache (`dead-code/dead-code-result-cache.ts`).
// Replays deslop's diagnostics — skipping the analysis worker entirely — when
// nothing the analysis reads has changed since the stored run.
// Bumped to 2: entries carry a per-file `files` map (mtime, size, content
// hash) instead of folding the file stats into the key, so a fresh checkout's
// bumped mtimes can be repaired against unchanged content.
export const DEAD_CODE_CACHE_SCHEMA_VERSION = 2;

export const DEAD_CODE_CACHE_FILENAME = "dead-code-cache.json";

// deslop's incremental analysis store (`DeslopConfig.incrementalCachePath`) —
// per-file parse summaries + collect/resolution/package-fact layers, written
// by the analysis WORKER for the changed-files case the whole-result cache
// above can't serve. Lives in the same per-project cache directory.
export const DEAD_CODE_SUMMARY_CACHE_FILENAME = "dead-code-summaries.json";

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

// Belt-and-suspenders wall-clock cap on the supply-chain check while it runs on
// a background fiber overlapping the lint pass. `Effect.timeout` measures from
// when the forked effect STARTS (at fork, before lint) — NOT from the join — so
// this is sized generously above the worst-case healthy run (FETCH_TIMEOUT_MS ×
// ceil(~45 deps / SUPPLY_CHAIN_FETCH_CONCURRENCY) ≈ 60s) to avoid cutting a
// slow-but-working scan, while still bounding a hung undici socket instead of
// letting it drag out the join. On expiry the check fails open to no
// diagnostics — the same outcome class as the per-package Socket fail-open.
export const SUPPLY_CHAIN_OVERLAP_TIMEOUT_MS = 90_000;

// On-disk TTL for a cached Socket artifact. A dependency's score/alerts are
// stable day-to-day and advisory, so a cached lookup within 24h skips the
// network entirely (the recurring CI win + faster repeated local scans);
// after expiry it re-fetches. Disabled by `REACT_DOCTOR_NO_CACHE`.
export const SUPPLY_CHAIN_CACHE_TTL_MS = 86_400_000;

// Subdirectory of the react-doctor cache dir holding per-PURL Socket responses.
export const SUPPLY_CHAIN_CACHE_SUBDIR = "supply-chain";

// Most severe Socket alerts to name in one supply-chain diagnostic before
// collapsing the remainder into a "+N more" count, so a noisy package
// doesn't flood the message.
export const SUPPLY_CHAIN_MAX_ALERTS_SHOWN = 3;

// Cap for the first-sentence Socket alert note woven into a diagnostic, so a
// paragraph-long malware description doesn't blow out the message line.
export const SUPPLY_CHAIN_ALERT_NOTE_MAX_CHARS = 160;

// Packages excluded from the Socket supply-chain check (the score gate).
// react-doctor already covers these frameworks' specific
// risks through dedicated rules — e.g. Next.js via the server-components /
// Next rule family — so a low Socket score would be redundant noise rather
// than an actionable, distinct supply-chain signal.
export const SUPPLY_CHAIN_IGNORED_PACKAGES: ReadonlySet<string> = new Set(["next"]);

export const LINE_FEED_UTF8_BYTE = 10;
