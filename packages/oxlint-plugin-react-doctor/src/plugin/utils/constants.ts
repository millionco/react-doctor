export const SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT = 65536;
export const SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT = 2048;
export const SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
export const SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const SOURCE_PROJECT_FINGERPRINT_MAX_PROBE_COUNT = 32768;

export const WEBPACK_ALIAS_CONFIG_MAX_FILE_COUNT = 16;
export const WEBPACK_ALIAS_CONFIG_MAX_DEPTH_COUNT = 32;
export const WEBPACK_ALIAS_COMMAND_MAX_TOKEN_COUNT = 32;
export const WEBPACK_ALIAS_SINGLE_VALUE_COUNT = 1;
export const WEBPACK_ALIAS_SUPPORTED_MAJOR_VERSION = 3;
export const WEBPACK_ALIAS_MERGE_MAJOR_VERSION = 4;
export const WEBPACK_ALIAS_SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".less",
]);
export const WEBPACK_ALIAS_FORBIDDEN_MEMBER_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "caller",
  "callee",
  "arguments",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
export const WEBPACK_ALIAS_UNSUPPORTED_MANIFEST_FIELDS = [
  "overrides",
  "resolutions",
  "pnpm",
  "babel",
  "browser",
];
export const WEBPACK_ALIAS_ALLOWED_GLOBAL_NAMES = new Set([
  "require",
  "module",
  "process",
  "__dirname",
  "JSON",
  "undefined",
  "NaN",
  "Infinity",
]);
export const WEBPACK_ALIAS_ALLOWED_BUILTIN_SOURCES = new Set([
  "path",
  "node:path",
  "os",
  "node:os",
]);
export const WEBPACK_ALIAS_MIN_MERGE_ARGUMENT_COUNT = 2;

export const WEBPACK_ALIAS_MAX_NAME_SEGMENT_COUNT = 16;

export const MEMBER_ALIAS_SMALL_COMPONENT_COUNT = 1;
export const MEMBER_ALIAS_LARGE_COMPONENT_COUNT = 8;
