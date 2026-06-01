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
// never the programmatic `@react-doctor/api` library.
export const SENTRY_DSN =
  "https://f253d570240a59b8dbd77b7a548ef133@o4510226365743104.ingest.us.sentry.io/4511487817809920";
