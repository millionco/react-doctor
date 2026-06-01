// Exit code for processes terminated by SIGINT (Ctrl-C), per POSIX
// (128 + signal number). Used by exit-gracefully.ts on SIGINT/SIGTERM.
export const SIGINT_EXIT_CODE = 130;

// Length of the `[node, script]` prefix that precedes user arguments in
// `process.argv`. Shared by the argv processors (flag stripping, help
// normalization, the `-V` alias).
export const NODE_ARGUMENT_COUNT = 2;

export const STAGED_FILES_TEMP_DIR_PREFIX = "react-doctor-staged-";

export const GIT_HOOK_EXECUTABLE_MODE = 0o755;

export const AGENT_HOOK_TIMEOUT_SECONDS = 120;

// Cap on files listed per rule in the agent-handoff prompt so it stays a
// compact, passable CLI argument.
export const HANDOFF_MAX_FILES_PER_RULE = 3;

export const SCORE_HEADER_ANIMATION_FRAME_COUNT = 40;
export const SCORE_HEADER_ANIMATION_FRAME_DELAY_MS = 50;
export const PERFECT_SCORE_RAINBOW_FRAME_COUNT = 16;
export const PERFECT_SCORE_RAINBOW_FRAME_DELAY_MS = 50;

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
