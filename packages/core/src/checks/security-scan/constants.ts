export const SECURITY_SCAN_MAX_FILES = 2500;
export const SECURITY_SCAN_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
export const SECURITY_SCAN_MAX_BUNDLE_FILE_SIZE_BYTES = 8 * 1024 * 1024;
export const SECURITY_SCAN_MAX_DIRECTORY_DEPTH = 8;

export const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".turbo",
  ".vercel",
  "coverage",
  "node_modules",
  "tmp",
]);
