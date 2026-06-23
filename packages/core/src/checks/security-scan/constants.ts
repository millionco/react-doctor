export const SECURITY_SCAN_MAX_FILES = 2500;
export const SECURITY_SCAN_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
export const SECURITY_SCAN_MAX_BUNDLE_FILE_SIZE_BYTES = 8 * 1024 * 1024;
export const SECURITY_SCAN_MAX_DIRECTORY_DEPTH = 8;

// Files the cooperative scan processes between event-loop yields. At ~4ms of
// regex per file this bounds each synchronous burst to ~60ms, small enough that
// the overlapping lint subprocesses' I/O callbacks (and sibling project scans)
// stay responsive while the scan runs.
export const SECURITY_SCAN_YIELD_FILE_INTERVAL = 16;

export const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".turbo",
  ".vercel",
  "coverage",
  "node_modules",
  "tmp",
]);
