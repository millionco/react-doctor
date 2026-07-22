// Exit code for processes terminated by SIGINT (Ctrl-C), per POSIX
// (128 + signal number). Used by exit-gracefully.ts on SIGINT/SIGTERM.
export const SIGINT_EXIT_CODE = 130;

// Exit code for a terminal hangup, per POSIX (128 + SIGHUP = 129). Used by
// guard-stdin.ts when the TTY backing an interactive prompt goes away
// mid-read (`read EIO`), so the CLI exits like an interrupted run instead of
// crashing on the uncaught stdin stream error.
export const TERMINAL_HANGUP_EXIT_CODE = 129;

// Length of the `[node, script]` prefix that precedes user arguments in
// `process.argv`. Shared by the argv processors (flag stripping, help
// normalization, the `-V` alias).
export const NODE_ARGUMENT_COUNT = 2;

// `projectName` for the per-user `Conf` store. React Doctor keeps all per-user
// state in one file, opened in exactly one place (`cli-state-store.ts`), with
// one key per concern: onboarding, the install-setup opt-out, and the
// once-per-repo prompt decisions (CI pitch, action upgrade).
export const REACT_DOCTOR_CONFIG_PROJECT_NAME = "react-doctor";

export const STAGED_FILES_TEMP_DIR_PREFIX = "react-doctor-staged-";
export const STAGED_SNAPSHOT_ADDITIONAL_CONFIG_FILENAMES = [
  ".babelrc",
  ".babelrc.json",
  ".eslintignore",
  ".eslintrc.json",
  ".oxlintignore",
  "app.config.cjs",
  "app.config.js",
  "app.config.json",
  "app.config.mjs",
  "app.config.ts",
  "app.json",
  "babel.config.cjs",
  "babel.config.js",
  "babel.config.json",
  "babel.config.mjs",
  "eslint.config.cjs",
  "eslint.config.cts",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.mts",
  "eslint.config.ts",
  "next.config.cjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "oxlint.config.json",
  "react-doctor.config.json",
  "vite.config.cjs",
  "vite.config.cts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.mts",
  "vite.config.ts",
  "vitest.config.js",
  "vitest.config.ts",
] as const;
export const BASELINE_FILES_TEMP_DIR_PREFIX = "react-doctor-baseline-";
// Bump on any breaking change to `CachedScanPayload`'s shape or diagnostic
// semantics so stale on-disk results are discarded wholesale.
// Bumped to 2: `CachedScanPayload` gained the required `supplyChainOverlapTimedOut`
// (supply-chain overlap) and `deadCodeOverlapped` (dead-code overlap) fields.
// Bumped to 3: gained the required `suppressedRuleCounts` field (suppression telemetry).
// Bumped to 4: gained the `manifestContentHash` replay guard, which every
// `lookup` verifies — pre-bump entries without it would never hit again.
// Bumped to 6: declaration-file parser diagnostic compatibility filtering
// changed the cached diagnostic set.
export const SCAN_RESULT_CACHE_SCHEMA_VERSION = 6;
export const SCAN_RESULT_CACHE_MAX_ENTRY_COUNT = 20;
export const SCAN_RESULT_CACHE_FILENAME = "scan-cache.json";
// The dirty-worktree cache-key fingerprint content-hashes every path `git
// status` reports; past this many entries the hashing could cost more than a
// cache hit saves, so the key builder bails to null (cache off) — the same
// worst case as the old clean-tree-only gate.
export const SCAN_RESULT_CACHE_MAX_DIRTY_STATUS_ENTRY_COUNT = 300;
// Dirty files larger than this are fingerprinted by `mtimeMs:size` instead of
// a content hash, bounding the key builder's read cost and memory.
export const SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Stdout cap for `runGit` (git-hook-shared.ts). Node's default `maxBuffer`
// is 1 MiB, and `git ls-files -v` alone exceeds that on repos with ~15-25k
// tracked files (getsentry/sentry: 1.25 MB) — execFileSync then throws
// ENOBUFS, runGit swallows it into `null`, and the whole-repo scan-result
// cache silently never stores or serves on exactly the large repos it helps
// most. 64 MiB clears monorepos with hundreds of thousands of files while
// still bounding a pathological child.
export const RUN_GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export const GIT_HOOK_EXECUTABLE_MODE = 0o755;

export const AGENT_HOOK_TIMEOUT_SECONDS = 120;

// Hard cap on the `gh repo view` default-branch probe. A healthy gh answers
// well under a second; a cold gh.exe on Windows CI has taken 30s+, and the
// git fallbacks behind it are correct for almost every repo — so fail fast.
export const GH_DEFAULT_BRANCH_PROBE_TIMEOUT_MS = 5000;

// Cap on open PRs scanned when checking for an already-open React Doctor
// setup PR (the idempotency guard). Far above any realistic count of open
// PRs whose head sits under the setup-branch prefix.
export const GH_PR_LIST_MAX = 100;

// Cap on files listed per rule in the agent-handoff prompt so it stays a
// compact, passable CLI argument.
export const HANDOFF_MAX_FILES_PER_RULE = 3;

// Social proof for the "Add to CI" pitch (shown in the post-scan handoff
// prompt and embedded in the agent-handoff prompt).
export const CI_TRUST_COMPANIES = "PayPal, Rippling, and Alibaba";

export const SCORE_HEADER_ANIMATION_FRAME_COUNT = 40;
export const SCORE_HEADER_ANIMATION_FRAME_DELAY_MS = 50;
export const PERFECT_SCORE_RAINBOW_FRAME_COUNT = 16;
export const PERFECT_SCORE_RAINBOW_FRAME_DELAY_MS = 50;

// First-run onboarding animation cadences: welcome typewriter + holds, the
// category count-up, and the score projection.
export const WELCOME_TYPEWRITER_CHAR_DELAY_MS = 16;
export const WELCOME_INTER_LINE_DELAY_MS = 250;
export const WELCOME_EXPLANATION_HOLD_MS = 1000;
// The category breakdown reveals one issue at a time (errors then warnings,
// category by category). Small/medium breakdowns step by a single unit per
// frame; `MAX_STEPS` caps the frame budget so a huge repo's reveal stays short
// (the per-step increment grows instead).
export const CATEGORY_COUNTUP_MAX_STEPS = 24;
export const CATEGORY_COUNTUP_FRAME_DELAY_MS = 70;
// Beat to hold on the settled category tally before the detail blocks reveal,
// so the at-a-glance breakdown reads before the report scrolls on.
export const CATEGORY_COUNTUP_SETTLE_HOLD_MS = 1000;
export const SCORE_PROJECTION_FRAME_COUNT = 16;
export const SCORE_PROJECTION_FRAME_DELAY_MS = 35;
// Terminal rows from the cursor (sitting just after the "you could improve"
// line) up to the score bar, so the projection redraw lands on the bar row:
// improve line, blank, face-bottom, branding, bar.
export const SCORE_PROJECTION_BAR_ROWS_ABOVE_CURSOR = 5;

// Floor for the terminal-aware typographic measure (`resolveMeasureWidth`).
// A terminal narrower than this is pathological; clamp here so prose can't
// collapse into a one-or-two-character sliver.
export const MIN_MEASURE_WIDTH_CHARS = 24;

// Floor for the score bar when it's shrunk to fit a narrow terminal (the score
// header clamps it to the columns left of the doctor face). Below this the bar
// stops conveying the score proportionally, so we let it sit at this width.
export const SCORE_BAR_MIN_WIDTH_CHARS = 10;

// Keep one column free at the right edge so a full-width line can't trip the
// terminal's auto-margin into a soft wrap, which breaks the in-place `\r`
// redraws (the score-bar animation and the welcome typewriter).
export const RIGHT_EDGE_SAFETY_COLUMNS = 1;

// Visible columns the box border + padding adds around a code frame
// (`│ ` … ` │` in box-text.ts). Reserved when fitting a box to the terminal.
export const BOX_BORDER_WIDTH_CHARS = 4;

// Minimum `VTE_VERSION` (GNOME Terminal, Tilix, and other VTE-based emulators)
// that renders OSC 8 hyperlinks — VTE added support in 0.50 (reported as 5000).
export const MINIMUM_VTE_VERSION_FOR_HYPERLINKS = 5000;

// Last-resort fallback when buildJsonReportError itself throws — keeps
// stdout valid JSON so downstream parsers don't see a half-written report.
export const INTERNAL_ERROR_JSON_FALLBACK =
  '{"schemaVersion":3,"version":"unknown","ok":false,"directory":"","mode":"full","diff":null,"projects":[],"diagnostics":[],"summary":{"errorCount":0,"warningCount":0,"affectedFileCount":0,"totalDiagnosticCount":0,"score":null,"scoreLabel":null},"elapsedMilliseconds":0,"error":{"message":"Internal error","name":"Error","chain":[]}}\n';

// Sentry DSN for CLI crash reporting. Public by design (DSNs are safe to
// embed in client-side code) and only used by the CLI application entry,
// never the programmatic `@react-doctor/api` library. Overridable at runtime
// via the standard `SENTRY_DSN` env var (read in `instrument.ts`).
export const SENTRY_DSN =
  "https://f253d570240a59b8dbd77b7a548ef133@o4510226365743104.ingest.us.sentry.io/4511487817809920";

// Sentry release identifier prefix. Releases are reported as
// `react-doctor@<version>` so they're globally unique within the Sentry org
// and so the SDK's `release` matches the value the CI source-map upload
// associates artifacts with (`scripts/sentry-sourcemaps.mjs`).
export const SENTRY_RELEASE_PREFIX = "react-doctor";

// Sample every trace (100%). `--debug` forces this for the run so the trace id
// it prints always points to a delivered trace, even when the env opted down.
export const FULL_TRACES_SAMPLE_RATE = 1;

// Default Sentry performance-tracing sample rate. Each CLI invocation becomes
// one transaction; runs are low-frequency (vs. web traffic) so full sampling
// gives the richest crash-correlated traces. Tunable per-run via the
// `SENTRY_TRACES_SAMPLE_RATE` env var (set to `0` to disable tracing entirely).
export const SENTRY_DEFAULT_TRACES_SAMPLE_RATE = FULL_TRACES_SAMPLE_RATE;

// Upper bound on how long the CLI blocks waiting for Sentry to deliver queued
// events (errors + transactions) before the process exits. The CLI tears down
// synchronously after rendering, so this awaited flush is what actually gets
// telemetry off the machine (see the Sentry CLI/serverless flush contract).
export const SENTRY_FLUSH_TIMEOUT_MS = 2000;

// OpenTelemetry/Sentry span status codes used by the Effect→Sentry tracer
// bridge (the SDK enum is 0 = unset, 1 = ok, 2 = error).
export const SENTRY_SPAN_STATUS_OK = 1;
export const SENTRY_SPAN_STATUS_ERROR = 2;

// OpenTelemetry trace-flags "sampled" bit, used to read/write the sampling
// decision in a `traceId`/`traceFlags` span context.
export const TRACE_FLAG_SAMPLED = 1;

// Nanoseconds per second, for converting Effect's epoch-nanosecond span clock
// into the `[seconds, nanosRemainder]` HrTime tuple Sentry/OTel expect.
export const NANOSECONDS_PER_SECOND = 1_000_000_000n;

// Sentry Application Metric names. Centralized so emit sites can't drift on a
// typo'd string and the full counter surface stays greppable in one place.
// Dotted, domain-grouped names (Sentry convention); high-cardinality
// dimensions (rule id, package manager, ...) go in attributes, never the name.
export const METRIC = {
  cliInvoked: "cli.invoked",
  cliError: "cli.error",
  cliEnvironmentError: "cli.env_error",
  stagedSnapshotDivergence: "staged.snapshot_divergence",
  projectDetected: "project.detected",
  projectPathSelected: "project.path_selected",
  projectConfigSelected: "project.config_selected",
  scanCompleted: "scan.completed",
  scanDuration: "scan.duration",
  scanPhaseDuration: "scan.phase_duration",
  scanFiles: "scan.files",
  scanScore: "scan.score",
  scanClean: "scan.clean",
  scanCheckSkipped: "scan.check_skipped",
  // One count per completed scan where no project resolved a React /
  // Preact runtime — the JSON report's `reactDetected: false` case. The
  // kill metric for the vacuous-clean-scan signal: if it never fires,
  // nobody points react-doctor at non-React targets and the surface can go.
  scanNoReactDetected: "scan.no_react_detected",
  baselineDegraded: "baseline.degraded",
  ruleFired: "rule.fired",
  // Rule-rejection telemetry, both keyed by `rule` + `source` attributes:
  // `rule.disabled` counts one per scan per config-off rule (`rules: "off"` /
  // `ignore.rules` — the former never fires, so this is its only signal);
  // `rule.suppressed` counts findings the pipeline dropped per user silencing
  // (config / per-path override / inline disable comment).
  ruleDisabled: "rule.disabled",
  ruleSuppressed: "rule.suppressed",
  lintFailed: "lint.failed",
  deadCodeFailed: "deadcode.failed",
  scoreUnavailable: "score.unavailable",
  oxlintWorkers: "oxlint.workers",
  agentHandoff: "agent.handoff",
  agentInstallHintShown: "agent.install_hint_shown",
  installCompleted: "install.completed",
  installAgent: "install.agent",
  installGitHook: "install.git_hook",
  installWorkflow: "install.workflow",
  installAgentHooks: "install.agent_hooks",
  installDependency: "install.dependency",
  // `react-doctor ci` management. `ci.scaffolded` counts a fresh workflow
  // (mode: tree | pr | exists), `ci.upgraded` an action-major bump, and
  // `ci.configured` a gate edit (applied: true|false). High-cardinality detail
  // — provider, gate level, scope — rides the attributes, never the name.
  ciScaffolded: "ci.scaffolded",
  ciUpgraded: "ci.upgraded",
  ciConfigured: "ci.configured",
  rulesChanged: "rules.changed",
  rulesQueried: "rules.queried",
  // Editor language server (`react-doctor experimental-lsp`). Each workspace
  // scan burst is one wide-event span (op `lsp.scan`) plus these metrics.
  lspSessionStarted: "lsp.session.started",
  lspScanCompleted: "lsp.scan.completed",
  lspScanDuration: "lsp.scan.duration",
  lspScanDiagnostics: "lsp.scan.diagnostics",
  aiTrainingWarningShown: "ai.training.warning_shown",
  jsonOutUsed: "json.out_used",
} as const;
