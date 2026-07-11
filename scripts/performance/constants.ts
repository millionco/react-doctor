export const DEFAULT_SAMPLE_COUNT = 5;
export const DEFAULT_WARMUP_COUNT = 1;
export const DEFAULT_WORKER_COUNTS = ["auto"];
export const DEFAULT_BENCHMARK_MODES = ["lint"];
export const DEFAULT_CACHE_COHORTS = ["no-cache"];
export const DEFAULT_OUTPUT_DIRECTORY = "tmp/performance";
export const BENCHMARK_OUTPUT_MARKER_FILENAME = ".react-doctor-performance-output";
export const BENCHMARK_OUTPUT_MARKER_CONTENT = "react-doctor-performance-output\n";
export const BENCHMARK_RUNS_DIRECTORY_NAME = "runs";
export const BENCHMARK_RUNS_MARKER_FILENAME = ".react-doctor-performance-runs";
export const BENCHMARK_RUNS_MARKER_CONTENT = "react-doctor-performance-runs\n";
export const DEFAULT_STRESS_OUTPUT_DIRECTORY = "tmp/performance/stress";
export const DEFAULT_STRESS_FILE_COUNT = 1_000;
export const DEFAULT_STRESS_COMPONENTS_PER_FILE_COUNT = 4;
export const DEFAULT_STRESS_CACHE_COHORTS = ["cold"];
export const STRESS_PROJECT_DIRECTORY_NAME = "react-doctor-performance-stress-project";
export const STRESS_PROJECT_MARKER_FILENAME = ".react-doctor-performance-stress-project";
export const STRESS_PROJECT_MARKER_CONTENT = "react-doctor-performance-stress-project\n";
export const STRESS_FILE_INDEX_CHARACTER_COUNT = 5;
export const STRESS_VALUES_PER_COMPONENT_COUNT = 64;
export const STRESS_VALUE_MODULUS = 7;
export const STRESS_BRANCH_MODULUS = 3;
export const STRESS_SUPPORT_SOURCE_FILE_COUNT = 2;
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
