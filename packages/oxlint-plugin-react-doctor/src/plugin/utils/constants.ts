import { FAST_REFRESH_CONFIG_FILENAMES } from "../constants/fast-refresh.js";

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

export const OBJECT_PROTOTYPE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
]);

export const NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT = 1;
export const NATIVE_FETCH_IDENTITY_MAX_ARGUMENT_COUNT = 2;
export const NATIVE_FETCH_IDENTITY_PRODUCER_STATEMENT_COUNT = 2;
export const NATIVE_FETCH_IDENTITY_REFUSED_MEMBER_NAMES = new Set([
  "prototype",
  "__proto__",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
export const NATIVE_FETCH_IDENTITY_REFUSED_GLOBAL_NAMES = new Set([
  "eval",
  "Function",
  "Reflect",
  "require",
]);
export const NATIVE_FETCH_IDENTITY_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "SyntaxError",
  "DOMException",
]);
export const NATIVE_FETCH_IDENTITY_PROVIDER_NAMES = new Set([
  "fetch",
  "Promise",
  "Response",
  ...NATIVE_FETCH_IDENTITY_ERROR_NAMES,
]);
export const NATIVE_FETCH_IDENTITY_PASSIVE_OBJECT_METHOD_NAMES = new Set([
  "keys",
  "entries",
  "values",
  "is",
  "hasOwn",
]);
export const NATIVE_FETCH_IDENTITY_REFUSED_MODULE_SOURCES = new Set([
  "module",
  "node:module",
  "vm",
  "node:vm",
]);

export const NATIVE_FETCH_IDENTITY_ACTIVE_HTML_PATTERN =
  /<script\b|\bon[a-z]+\s*=|javascript\s*:/iu;

export const NATIVE_FETCH_IDENTITY_BUILD_CONFIG_FILE_NAMES = new Set([
  ...FAST_REFRESH_CONFIG_FILENAMES,
  "webpack.config.cts",
  "webpack.config.mts",
]);
export const NATIVE_FETCH_IDENTITY_CRA_COMMANDS = new Set([
  "react-scripts start",
  "react-scripts build",
  "react-scripts test",
  "react-scripts eject",
]);
export const NATIVE_FETCH_IDENTITY_REFUSED_MANIFEST_FIELDS = [
  "babel",
  "browser",
  "overrides",
  "pnpm",
  "alias",
];
export const NATIVE_FETCH_IDENTITY_PROVIDER_RESOLUTION_PATTERN =
  /(?:^|\/)(?:react|react-dom|react-scripts)(?:$|@|\/)/u;
export const NATIVE_FETCH_IDENTITY_RESOLUTION_GLOB_PATTERN = /[?*{]|\[/u;
export const NATIVE_FETCH_IDENTITY_CRA_MAJOR_VERSION = 5;

export const IMPORTED_CONNECTION_SINGLE_COUNT = 1;
export const IMPORTED_CONNECTION_METHOD_COUNT = 2;
export const IMPORTED_CONNECTION_HELPER_MAX_DEPTH = 4;
export const IMPORTED_CONNECTION_NATIVE_METHODS = new Set([
  "addTransceiver",
  "getTransceivers",
  "createOffer",
  "setLocalDescription",
  "setRemoteDescription",
]);
export const IMPORTED_CONNECTION_NATIVE_FIELDS = new Set(["localDescription", "iceGatheringState"]);
export const IMPORTED_CONNECTION_NATIVE_EVENTS = new Set(["ontrack", "onicegatheringstatechange"]);
export const IMPORTED_CONNECTION_PASSIVE_OBJECT_METHODS = new Set(["keys", "values", "entries"]);
export const IMPORTED_CONNECTION_NEXT_CONFIG_NAMES = [
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
];
export const IMPORTED_CONNECTION_CONFIG_NAMES = [
  "webpack.config.js",
  "webpack.config.cjs",
  "webpack.config.mjs",
  "webpack.config.ts",
  "vite.config.js",
  "vite.config.ts",
  ".swcrc",
  "swc.config.js",
];
export const IMPORTED_CONNECTION_SCRIPT_NAME_PATTERN =
  /^(?:pre|post)?(?:dev|build|preview|start)$/u;
export const IMPORTED_CONNECTION_NEXT_COMMAND_PATTERN = /^next (?:dev|build|start)$/u;
