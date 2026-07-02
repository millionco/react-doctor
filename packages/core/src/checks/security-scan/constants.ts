export const SECURITY_SCAN_MAX_FILES = 2500;
export const SECURITY_SCAN_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
export const SECURITY_SCAN_MAX_BUNDLE_FILE_SIZE_BYTES = 8 * 1024 * 1024;
export const SECURITY_SCAN_MAX_DIRECTORY_DEPTH = 8;

// Longest synchronous burst the cooperative scan may hold the event loop
// before yielding, checked between every (file, rule) step. The overlapping
// lint pass spawns and drains its child processes from main-thread
// continuations, so bursts beyond ~a frame idle the whole worker pool.
export const SECURITY_SCAN_YIELD_BUDGET_MS = 12;

export const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".turbo",
  ".vercel",
  "coverage",
  "node_modules",
  "tmp",
]);
