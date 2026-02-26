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

export const ESTIMATE_SCORE_API_URL = "https://www.react.doctor/api/estimate-score";

export const SHARE_BASE_URL = "https://www.react.doctor/share";

export const OPEN_BASE_URL = "https://www.react.doctor/open";

export const FETCH_TIMEOUT_MS = 10_000;

export const GIT_LS_FILES_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

// HACK: Windows CreateProcessW limits total command-line length to 32,767 chars.
// Use a conservative threshold to leave room for the executable path and quoting overhead.
export const SPAWN_ARGS_MAX_LENGTH_CHARS = 24_000;

export const OFFLINE_MESSAGE =
  "You are offline, could not calculate score. Reconnect to calculate.";

export const OFFLINE_FLAG_MESSAGE = "Score not calculated. Remove --offline to calculate score.";

export const DEFAULT_BRANCH_CANDIDATES = ["main", "master"];

export const ERROR_RULE_PENALTY = 1.5;

export const WARNING_RULE_PENALTY = 0.75;

export const ERROR_ESTIMATED_FIX_RATE = 0.85;

export const WARNING_ESTIMATED_FIX_RATE = 0.8;

export const MAX_KNIP_RETRIES = 5;

export const OXLINT_NODE_REQUIREMENT = "^20.19.0 || >=22.12.0";

export const OXLINT_RECOMMENDED_NODE_MAJOR = 24;

export const AMI_WEBSITE_URL = "https://ami.dev";

export const AMI_INSTALL_URL = `${AMI_WEBSITE_URL}/install.sh`;

export const AMI_RELEASES_URL = "https://github.com/millionco/ami-releases/releases";
