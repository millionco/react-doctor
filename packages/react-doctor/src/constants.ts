export const SOURCE_FILE_PATTERN = /\.(tsx?|jsx?)$/;

export const JSX_FILE_PATTERN = /\.(tsx|jsx)$/;

export const MILLISECONDS_PER_SECOND = 1000;

export const ERROR_PREVIEW_LENGTH_CHARS = 200;

export const PERFECT_SCORE = 100;

export const SCORE_GOOD_THRESHOLD = 75;

export const SCORE_OK_THRESHOLD = 50;

export const SCORE_BAR_WIDTH_CHARS = 50;

export const SUMMARY_BOX_HORIZONTAL_PADDING_CHARS = 1;

export const SUMMARY_BOX_OUTER_INDENT_CHARS = 2;

export const SCORE_API_URL = "https://www.react.doctor/api/score";

export const SHARE_BASE_URL = "https://www.react.doctor/share";

export const FETCH_TIMEOUT_MS = 10_000;

export const GIT_LS_FILES_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

// HACK: Windows CreateProcessW limits total command-line length to 32,767 chars.
// Use a conservative threshold to leave room for the executable path and quoting overhead.
export const SPAWN_ARGS_MAX_LENGTH_CHARS = 24_000;

// HACK: oxlint can SIGABRT on very large file sets due to memory pressure.
// Cap each batch to avoid OOM crashes on projects with 100+ source files.
export const OXLINT_MAX_FILES_PER_BATCH = 500;

export const OFFLINE_MESSAGE = "Score calculated locally (offline mode).";

export const DEFAULT_BRANCH_CANDIDATES = ["main", "master"];

export const ERROR_RULE_PENALTY = 1.5;

export const WARNING_RULE_PENALTY = 0.75;

export const KNIP_CONFIG_LOCATIONS = [
  "knip.json",
  "knip.jsonc",
  ".knip.json",
  ".knip.jsonc",
  "knip.ts",
  "knip.js",
  "knip.config.ts",
  "knip.config.js",
];

export const OXLINT_NODE_REQUIREMENT = "^20.19.0 || >=22.12.0";

export const OXLINT_RECOMMENDED_NODE_MAJOR = 24;

export const GIT_SHOW_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage"]);

export const CANONICAL_GITHUB_URL = "https://github.com/millionco/react-doctor";

export const KNIP_TOTAL_ATTEMPTS = 6;

export const PROXY_OUTPUT_MAX_BYTES = 50 * 1024 * 1024;

export const buildNoReactDependencyError = (directory: string): string =>
  `No React dependency found in ${directory}/package.json. Add "react" to dependencies (or peerDependencies) and re-run.`;
