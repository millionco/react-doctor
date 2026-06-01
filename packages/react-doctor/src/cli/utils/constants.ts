// Exit code for processes terminated by SIGINT (Ctrl-C), per POSIX
// (128 + signal number). Used by exit-gracefully.ts on SIGINT/SIGTERM.
export const SIGINT_EXIT_CODE = 130;

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

// Loopback host the debug server binds to by default; kept local so the
// NDJSON ingest endpoint is not exposed beyond the machine.
export const DEBUG_DEFAULT_HOST = "127.0.0.1";

// Bytes of randomness for a `react-doctor debug` session id; hex-encoded
// into a 6-char id that namespaces the per-session NDJSON log file.
export const DEBUG_SESSION_ID_BYTE_LENGTH = 3;

// How long the idempotency probe waits for an already-running debug
// server to answer its health check before assuming the lock is stale.
export const DEBUG_LOCK_PING_TIMEOUT_MS = 1000;

// Subdirectory (under the project root, or the OS tmpdir as a fallback)
// that holds debug session logs and the singleton server lock file.
export const DEBUG_LOG_DIRECTORY_NAME = "react-doctor-debug";

// Cap on remembered log-entry ids per session for POST de-duplication;
// the set is cleared once it grows past this to bound memory.
export const DEBUG_MAX_DEDUP_ENTRIES = 10_000;
