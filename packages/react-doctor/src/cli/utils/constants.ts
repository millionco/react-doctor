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

export const STAGED_FILES_TEMP_DIR_PREFIX = "react-doctor-staged-";
export const BASELINE_FILES_TEMP_DIR_PREFIX = "react-doctor-baseline-";
export const SCAN_RESULT_CACHE_SCHEMA_VERSION = 1;
export const SCAN_RESULT_CACHE_MAX_ENTRY_COUNT = 20;
export const CACHE_FILENAME_HASH_LENGTH_CHARS = 16;

export const GIT_HOOK_EXECUTABLE_MODE = 0o755;

export const AGENT_HOOK_TIMEOUT_SECONDS = 120;

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

// Last-resort fallback when buildJsonReportError itself throws — keeps
// stdout valid JSON so downstream parsers don't see a half-written report.
export const INTERNAL_ERROR_JSON_FALLBACK =
  '{"schemaVersion":1,"ok":false,"error":{"message":"Internal error","name":"Error","chain":[]}}\n';

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

// Default Sentry performance-tracing sample rate. Each CLI invocation becomes
// one transaction; runs are low-frequency (vs. web traffic) so full sampling
// gives the richest crash-correlated traces. Tunable per-run via the
// `SENTRY_TRACES_SAMPLE_RATE` env var (set to `0` to disable tracing entirely).
export const SENTRY_DEFAULT_TRACES_SAMPLE_RATE = 1;

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
  projectDetected: "project.detected",
  scanCompleted: "scan.completed",
  scanDuration: "scan.duration",
  scanPhaseDuration: "scan.phase_duration",
  scanFiles: "scan.files",
  scanScore: "scan.score",
  scanClean: "scan.clean",
  scanCheckSkipped: "scan.check_skipped",
  baselineDegraded: "baseline.degraded",
  ruleFired: "rule.fired",
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
  rulesChanged: "rules.changed",
  rulesQueried: "rules.queried",
  // Editor language server (`react-doctor experimental-lsp`). Each workspace
  // scan burst is one wide-event span (op `lsp.scan`) plus these metrics.
  lspSessionStarted: "lsp.session.started",
  lspScanCompleted: "lsp.scan.completed",
  lspScanDuration: "lsp.scan.duration",
  lspScanDiagnostics: "lsp.scan.diagnostics",
} as const;
