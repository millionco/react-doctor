export const DEFAULT_SAMPLE_COUNT = 5;
export const DEFAULT_WARMUP_COUNT = 1;
export const DEFAULT_WORKER_COUNTS = ["auto"];
export const DEFAULT_BENCHMARK_MODES = ["lint"];
export const DEFAULT_CACHE_COHORTS = ["no-cache"];
export const DEFAULT_OUTPUT_DIRECTORY = "tmp/performance";
export const BENCHMARK_TIMEOUT_MS = 30 * 60 * 1_000;
export const COMMAND_MAX_BUFFER_BYTES = 100_000_000;
export const BYTES_PER_KIBIBYTE = 1_024;
export const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
export const MILLISECONDS_PER_SECOND = 1_000;
export const MICROSECONDS_PER_MILLISECOND = 1_000;
export const MICROSECONDS_PER_SECOND = MICROSECONDS_PER_MILLISECOND * MILLISECONDS_PER_SECOND;
export const PERCENT_MULTIPLIER = 100;
export const PROFILE_TOP_FRAME_COUNT = 30;
export const COMPARISON_REGRESSION_RATIO = 0.1;
export const COMPARISON_REGRESSION_MIN_MS = 250;
export const SOURCE_FILE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);
export const FALLBACK_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
