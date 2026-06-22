// Source file extensions React Doctor can lint. Reconstructed files outside
// this allowlist are dropped before scanning (assets, notebooks, markdown).
export const STATS_LINTABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

// Default cap on agent sessions scanned in one `stats` run. Each session is one
// oxlint subprocess, so an unbounded run over a machine's whole history could
// spawn thousands. Bounded by default; raise with `--limit`.
export const STATS_DEFAULT_SESSION_LIMIT = 200;

// Concurrent per-session lint scans. Each scan pins oxlint to a single worker,
// so this is the real fan-out across CPU cores.
export const STATS_SCAN_CONCURRENCY = 6;

// Temp-dir prefix for a per-session reconstructed source tree.
export const STATS_TEMP_DIR_PREFIX = "react-doctor-stats-";

// Discovery loads each candidate session from disk/SQLite synchronously. Yield
// to the event loop after this many loads so the spinner keeps animating instead
// of looking frozen during the initial history walk.
export const STATS_DISCOVERY_YIELD_INTERVAL = 10;

// A group (model/provider) needs at least this many scanned files before its
// score is shown; below it the sample is too small to rank fairly.
export const STATS_MIN_FILES_FOR_SCORE = 3;

// Confidence weighting for the leaderboard. A group's raw 0-100 score is pulled
// toward the global mean by a Bayesian average so a model can't top the board on
// a handful of files. The prior carries this many "average" effective files of
// weight; a group needs more effective files than this before its own score
// dominates the prior.
export const STATS_SCORE_PRIOR_FILES = 25;

// Sessions discount the file weight (many files from a single session are one
// correlated sample), but only mildly — files are the heavier signal. Session
// reliability ramps from the floor below toward 1 as sessions grow:
//   reliability = FLOOR + (1 - FLOOR) * sessions / (sessions + PRIOR)
export const STATS_SCORE_SESSION_PRIOR = 2;

// Floor on session reliability: a group keeps at least this fraction of its file
// weight no matter how few sessions it has, so sessions can only shave off the
// remaining (1 - FLOOR). Closer to 1 = files dominate even harder.
export const STATS_SCORE_SESSION_FLOOR = 0.6;

// Models shown in the terminal leaderboard. The full ranking is always in the
// `--json` report; the table stays short so it reads at a glance.
export const STATS_LEADERBOARD_TOP_N = 5;

// Most-fired rules shown per group in the report.
export const STATS_TOP_RULES_PER_GROUP = 3;

// Label used when a session does not expose a stable model id (e.g. a Cursor
// composer left on the "Auto" default with no per-bubble model recorded).
export const STATS_UNKNOWN_MODEL = "unknown";

// Width (in cells) of the unicode score bar drawn next to each leaderboard score.
export const STATS_SCORE_BAR_WIDTH = 16;

// Score thresholds that pick the bar color: at or above HIGH is green, at or
// above MEDIUM is yellow, below is red.
export const STATS_SCORE_COLOR_HIGH = 80;
export const STATS_SCORE_COLOR_MEDIUM = 50;
