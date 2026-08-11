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
export const BASELINE_SOURCE_COPY_CONCURRENCY = 32;
// Bump on any breaking change to `CachedScanPayload`'s shape or diagnostic
// semantics so stale on-disk results are discarded wholesale.
// Bumped to 2: `CachedScanPayload` gained the required `supplyChainOverlapTimedOut`
// (supply-chain overlap) and `deadCodeOverlapped` (dead-code overlap) fields.
// Bumped to 3: gained the required `suppressedRuleCounts` field (suppression telemetry).
// Bumped to 4: gained the `manifestContentHash` replay guard, which every
// `lookup` verifies — pre-bump entries without it would never hit again.
// Bumped to 6: declaration-file parser diagnostic compatibility filtering
// changed the cached diagnostic set.
// Bumped to 7: maintainability diagnostics replace the removed dead-code pass.
export const SCAN_RESULT_CACHE_SCHEMA_VERSION = 7;
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

export const TUI_ISSUE_PROMPT_MAX_SITES = 8;

export const TUI_MIN_NODE_MAJOR_VERSION = 22;

export const TUI_LIVE_FEED_MAX_ENTRIES = 25;
export const TUI_PROGRESS_UPDATE_INTERVAL_MS = 250;
export const TUI_RECENT_LIVE_DIAGNOSTIC_COUNT = 5;
export const TUI_DETAIL_INDENT_COLUMNS = 2;
export const TUI_PROJECT_SELECT_CHROME_ROWS = 3;
export const TUI_PROJECT_SELECT_MIN_LIST_ROWS = 1;
export const TUI_PROJECT_SELECT_FILTER_ROWS = 1;
export const TUI_PROJECT_SELECT_FOOTER_MARGIN_ROWS = 1;
export const TUI_REPORT_DETAIL_ROWS = 15;
export const TUI_REPORT_STATUS_ROWS = 3;
export const TUI_REPORT_DIVIDER_ROWS = 1;
export const TUI_REPORT_LIST_MARGIN_ROWS = 1;
export const TUI_REPORT_SECTION_GAP_ROWS = 1;
export const TUI_REPORT_MIN_LIST_ROWS = 3;
export const TUI_REPORT_STACKED_MAX_LIST_ROWS = 16;
export const TUI_REPORT_VIEWPORT_MARGIN_ROWS = 1;
export const TUI_REPORT_ACTION_MENU_MARGIN_ROWS = 1;
export const TUI_REPORT_ACTION_MENU_ITEM_GAP_ROWS = 1;
export const TUI_REPORT_REVEAL_STEP_INCREMENT = 1;
export const TUI_REPORT_ISSUE_STREAM_VISIBLE_ROWS = 3;
export const TUI_REPORT_ISSUE_STREAM_MIN_STEPS = 8;
export const TUI_REPORT_ISSUE_STREAM_MAX_STEPS = 12;
export const TUI_REPORT_ISSUE_STREAM_FRAME_DELAY_MS = 125;
export const TUI_REPORT_VIEWER_SCORE_HEADER_ROWS = 4;
export const TUI_REPORT_COMPACT_STATUS_ROWS = 1;
export const TUI_REPORT_COMPACT_MAX_ROWS =
  TUI_REPORT_LIST_MARGIN_ROWS +
  TUI_REPORT_DIVIDER_ROWS +
  TUI_REPORT_STATUS_ROWS +
  TUI_REPORT_DETAIL_ROWS +
  TUI_REPORT_MIN_LIST_ROWS;
export const TUI_REPORT_MIN_WIDTH_CHARS = 1;
export const TUI_REPORT_WIDE_MIN_COLUMNS = 120;
export const TUI_REPORT_WIDE_MIN_ROWS = 22;
export const TUI_REPORT_DETAIL_WIDTH_FRACTION = 0.6;
export const TUI_REPORT_COLUMN_GUTTER_COLUMNS = 3;
export const TUI_REPORT_MIN_COLUMN_WIDTH_CHARS = 20;
export const TUI_REPORT_SPLIT_MARGIN_COLUMNS = 1;
export const TUI_REPORT_SPLIT_PADDING_COLUMNS = 1;
export const TUI_SCORE_FACE_OFFSET_COLUMNS = 11;
export const TUI_SCORE_RIGHT_EDGE_SAFETY_COLUMNS = 2;
export const TUI_HALF_PAGE_DIVISOR = 2;
export const TUI_DEFAULT_TERMINAL_COLUMNS = 80;
export const TUI_DEFAULT_TERMINAL_ROWS = 24;
export const TUI_HORIZONTAL_PADDING_COLUMNS = 2;
export const TUI_PROJECT_NAME_GAP_COLUMNS = 2;
export const TUI_PRINTABLE_ASCII_MIN_CODE_POINT = 32;
export const TUI_FUZZY_CONSECUTIVE_BONUS = 5;
export const TUI_FUZZY_WORD_BOUNDARY_BONUS = 10;
export const TUI_FUZZY_LEADING_PENALTY = 1;

export const CI_TRUST_COMPANIES = "PayPal, Rippling, and Alibaba";

export const SCORE_HEADER_ANIMATION_FRAME_COUNT = 40;
export const SCORE_HEADER_ANIMATION_FRAME_DELAY_MS = 50;
export const SCORE_PROJECTION_FRAME_COUNT = 16;
export const SCORE_PROJECTION_FRAME_DELAY_MS = 35;

// Floor for the terminal-aware typographic measure (`resolveMeasureWidth`).
// A terminal narrower than this is pathological; clamp here so prose can't
// collapse into a one-or-two-character sliver.
export const MIN_MEASURE_WIDTH_CHARS = 24;

// Floor for the score bar when it's shrunk to fit a narrow terminal (the score
// header clamps it to the columns left of the doctor face). Below this the bar
// stops conveying the score proportionally, so we let it sit at this width.
export const SCORE_BAR_MIN_WIDTH_CHARS = 10;

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

// Axiom ingest token for first-party CLI telemetry (traces + metrics). Unlike a
// Sentry DSN, an Axiom API token is a real credential, so this one is minted
// `ingest:create` only, scoped to exactly the two datasets below, with no
// expiry and no organization permissions — it can write those datasets and
// nothing else. It ships inside the published tarball and is therefore
// extractable; rotation means cutting a release, and an Axiom monitor on
// anomalous ingest volume is the detection. If abuse ever materializes, the
// standing alternative is to proxy ingest through `www.react.doctor` (which
// already hosts the score API) so the token stops shipping at all.
// Overridable at runtime via `REACT_DOCTOR_AXIOM_TOKEN` for local testing
// against a scratch dataset.
export const AXIOM_INGEST_TOKEN = "xaat-31b59107-855d-4917-8fab-6dc29fb459ce";

// Events-type dataset receiving spans (the per-run root span carries the wide
// event), and the Metrics-type dataset receiving counters and distributions.
// Axiom types datasets at creation and will not accept metrics into an events
// dataset, which is why these are separate.
// Effect span clocks are epoch nanoseconds; `Date.now()` is milliseconds.
export const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

export const AXIOM_TRACES_DATASET = "react-doctor";
export const AXIOM_METRICS_DATASET = "react-doctor-metrics";

// Sentry release identifier prefix. Releases are reported as
// `react-doctor@<version>` so they're globally unique within the Sentry org
// and so the SDK's `release` matches the value the CI source-map upload
// associates artifacts with (`scripts/sentry-sourcemaps.mjs`).
export const SENTRY_RELEASE_PREFIX = "react-doctor";

// Upper bound on how long the CLI blocks waiting for Sentry to deliver queued
// events (errors + transactions) before the process exits. The CLI tears down
// synchronously after rendering, so this awaited flush is what actually gets
// telemetry off the machine (see the Sentry CLI/serverless flush contract).
export const SENTRY_FLUSH_TIMEOUT_MS = 2000;

// Bucket boundaries shared by every `recordDistribution` histogram. Effect
// requires explicit boundaries (unlike Sentry's distributions, which kept raw
// values and computed percentiles server-side), and the distributions this CLI
// emits span two very different ranges: small counts and scores (`scan.score`
// 0-100, `scan.files`, `oxlint.workers`) and millisecond durations
// (`scan.duration`, `scan.phase_duration`, `scan.feedback_delay`). One
// roughly-exponential ladder covers both — dense at the low end for scores and
// counts, reaching ten minutes for the slowest scans. Axiom's metrics store
// drops bucket metadata and assumes equal-width buckets, so finer per-metric
// tuning would not survive the trip; the wide event carries exact timings when
// precision matters.
export const METRIC_DISTRIBUTION_BOUNDARIES = [
  0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000,
  600_000,
];

// Metric names. Centralized so emit sites can't drift on a typo'd string and
// the full counter surface stays greppable in one place.
// Dotted, domain-grouped names (Sentry convention); high-cardinality
// dimensions (rule id, package manager, ...) go in attributes, never the name.
export const METRIC = {
  cliInvoked: "cli.invoked",
  cliError: "cli.error",
  cliEnvironmentError: "cli.env_error",
  stagedSnapshotDivergence: "staged.snapshot_divergence",
  // The kill metric for per-package `--staged` scanning: one count per run that
  // scanned a package instead of the scan root, with how many in an attribute.
  // If it never fires, no repository points `--staged` at its packages and the
  // ownership map earns nothing.
  stagedPerProject: "staged.per_project",
  projectDetected: "project.detected",
  projectPathSelected: "project.path_selected",
  projectConfigSelected: "project.config_selected",
  scanCompleted: "scan.completed",
  scanDuration: "scan.duration",
  scanFeedbackDelay: "scan.feedback_delay",
  scanPhaseDuration: "scan.phase_duration",
  scanFiles: "scan.files",
  scanScore: "scan.score",
  scanScoreRetry: "scan.score_retry",
  scanClean: "scan.clean",
  scanCheckSkipped: "scan.check_skipped",
  // Kill metric for queued-project deadline reporting. If this never fires,
  // the additive JSON/TUI skipped-project surface is not carrying user value.
  scanProjectSkipped: "scan.project_skipped",
  // Kill metric for workspace-owned maintainability analysis. If this never fires,
  // multi-project scans do not include their root and cannot share the pass.
  scanWorkspaceMaintainabilityShared: "scan.workspace_maintainability_shared",
  // One count per completed scan where no project resolved a supported
  // framework or library capability. The kill metric for the
  // vacuous-clean-scan signal: if it never fires, the warning surface can go.
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
  maintainabilityFailed: "maintainability.failed",
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
  tuiCompactReportShown: "tui.compact_report_shown",
  tuiFindingNavigated: "tui.finding_navigated",
  tuiIssueStreamShown: "tui.issue_stream_shown",
  tuiProjectPathContextShown: "tui.project_path_context_shown",
  tuiProjectSelectShown: "tui.project_select_shown",
  tuiReportActionSelected: "tui.report_action_selected",
  tuiCancelled: "tui.cancelled",
  tuiScanInlineShown: "tui.scan_inline_shown",
  tuiStackedReportCapped: "tui.stacked_report_capped",
  aiTrainingWarningShown: "ai.training.warning_shown",
  jsonOutUsed: "json.out_used",
} as const;

export const SCORE_RETRY_MAX_CONCURRENCY = 64;
