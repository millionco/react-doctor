// Exit code for processes terminated by SIGINT (Ctrl-C), per POSIX
// (128 + signal number). Used by exit-gracefully.ts on SIGINT/SIGTERM.
export const SIGINT_EXIT_CODE = 130;

export const STAGED_FILES_TEMP_DIR_PREFIX = "react-doctor-staged-";

export const GIT_HOOK_EXECUTABLE_MODE = 0o755;

export const AGENT_HOOK_TIMEOUT_SECONDS = 120;

export const SETUP_PROMPT_DELAY_MS = 100;

export const SCORE_HEADER_ANIMATION_FRAME_COUNT = 40;
export const SCORE_HEADER_ANIMATION_FRAME_DELAY_MS = 50;
export const PERFECT_SCORE_RAINBOW_FRAME_COUNT = 16;
export const PERFECT_SCORE_RAINBOW_FRAME_DELAY_MS = 50;

// Last-resort fallback when buildJsonReportError itself throws — keeps
// stdout valid JSON so downstream parsers don't see a half-written report.
export const INTERNAL_ERROR_JSON_FALLBACK =
  '{"schemaVersion":1,"ok":false,"error":{"message":"Internal error","name":"Error","chain":[]}}\n';

// Better Stack (Sentry-compatible) error-tracking ingest DSN. This is a
// public ingest key, not a secret — it only authorizes sending crash
// events, never reading them. Reporting is strictly opt-in; see
// error-tracking.ts.
export const BETTER_STACK_ERROR_TRACKING_DSN =
  "https://wWK3Nv2j8X2w8gLBDSYrDWQw@s2476923.eu-fsn-3.betterstackdata.com/2476923";

// Max time to wait for queued crash events to reach Better Stack before
// the CLI exits. The process tears down immediately after an error, so
// the capture path must flush within this window or drop the event.
export const ERROR_TRACKING_FLUSH_TIMEOUT_MS = 2000;
