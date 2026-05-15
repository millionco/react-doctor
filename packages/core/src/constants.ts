// SOURCE_FILE_PATTERN, GIT_LS_FILES_MAX_BUFFER_BYTES, and
// IGNORED_DIRECTORIES live in @react-doctor/project-info (which core
// already depends on). Re-exported here so core consumers don't have
// to know which package owns each constant.
export {
  GIT_LS_FILES_MAX_BUFFER_BYTES,
  IGNORED_DIRECTORIES,
  SOURCE_FILE_PATTERN,
} from "@react-doctor/project-info";

export const JSX_FILE_PATTERN = /\.(tsx|jsx)$/;

export const MILLISECONDS_PER_SECOND = 1000;

export const ERROR_PREVIEW_LENGTH_CHARS = 200;

export const PERFECT_SCORE = 100;

export const SCORE_GOOD_THRESHOLD = 75;

export const SCORE_OK_THRESHOLD = 50;

export const SCORE_BAR_WIDTH_CHARS = 50;

export const SCORE_API_URL = "https://www.react.doctor/api/score";

export const SHARE_BASE_URL = "https://www.react.doctor/share";

export const FETCH_TIMEOUT_MS = 10_000;

// HACK: Windows CreateProcessW limits total command-line length to 32,767 chars.
// Use a conservative threshold to leave room for the executable path and quoting overhead.
export const SPAWN_ARGS_MAX_LENGTH_CHARS = 24_000;

// HACK: oxlint can SIGABRT on very large file sets due to memory pressure.
// Cap each batch to avoid OOM crashes on projects with 100+ source files.
export const OXLINT_MAX_FILES_PER_BATCH = 500;

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

export const CANONICAL_GITHUB_URL = "https://github.com/millionco/react-doctor";

export const SKILL_NAME = "react-doctor";

export const OXLINT_OUTPUT_MAX_BYTES = 50 * 1024 * 1024;

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

// Minimum width of the rule-name column in the diagnostics list. Pads
// shorter rule names so the right-aligned `N sites` count stays in a
// consistent column even when one rule has a much longer identifier.
export const RULE_NAME_COLUMN_WIDTH_CHARS = 36;

export const OUTPUT_DETAIL_WRAP_WIDTH_CHARS = 88;

export const SPINNER_INDENT_CHARS = 0;
