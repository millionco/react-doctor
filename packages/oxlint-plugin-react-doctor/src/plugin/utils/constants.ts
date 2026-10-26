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
export const NEXT_APPLICATION_SCRIPT_NAME_PATTERN = /^(?:pre|post)?(?:dev|build|preview|start)$/u;
export const NEXT_APPLICATION_COMMAND_PATTERN = /^next (?:dev|build|start)$/u;

export const NATIVE_WINDOW_SCROLL_SINGLE_VALUE_COUNT = 1;
export const NATIVE_WINDOW_SCROLL_REFUSED_ATTRIBUTES = new Set([
  "ref",
  "is",
  "disabled",
  "inert",
  "hidden",
  "aria-disabled",
  "dangerouslySetInnerHTML",
  "children",
]);
export const NATIVE_WINDOW_SCROLL_REFUSED_GLOBAL_NAMES = new Set([
  "React",
  "globalThis",
  "global",
  "self",
  "Object",
  "Reflect",
  "Function",
  "eval",
  "require",
  "Window",
  "document",
  "parent",
  "top",
  "frames",
  "opener",
]);
export const NATIVE_WINDOW_SCROLL_NEXT_CONFIG_NAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
];
export const NATIVE_WINDOW_SCROLL_REFUSED_CONFIG_NAMES = [
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.mts",
  "webpack.config.js",
  "webpack.config.cjs",
  "webpack.config.mjs",
  "rspack.config.js",
  "rspack.config.ts",
];

export const NATIVE_WINDOW_SCROLL_REFUSED_MANIFEST_FIELDS = [
  "babel",
  "imports",
  "overrides",
  "resolutions",
  "pnpm",
  "browser",
];

export const NATIVE_WINDOW_SCROLL_ALLOWED_WINDOW_MEMBERS = new Set([
  "scrollY",
  "addEventListener",
  "removeEventListener",
  "scrollTo",
]);
export const NATIVE_WINDOW_SCROLL_PROVIDER_MEMBER_CAPABILITIES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

export const COMBOBOX_MIN_DISMISS_DELAY_MS = 0;
export const COMBOBOX_OPEN_KEY_NAMES: ReadonlySet<string> = new Set([
  "Enter",
  " ",
  "ArrowDown",
  "ArrowUp",
]);
export const COMBOBOX_CSS_MODULE_SOURCE_PATTERN = /\.module\.(?:css|less|sass|scss)$/u;
export const COMBOBOX_PROTECTED_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "hidden",
  "inert",
  "aria-hidden",
  "is",
  "dangerouslySetInnerHTML",
  "onClickCapture",
  "onKeyDownCapture",
  "onKeyUpCapture",
  "onKeyPressCapture",
]);
export const COMBOBOX_REFUSED_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  ...NATIVE_FETCH_IDENTITY_REFUSED_GLOBAL_NAMES,
  "globalThis",
  "global",
  "self",
  "Window",
  "setTimeout",
  "clearTimeout",
  "addEventListener",
  "removeEventListener",
]);
export const COMBOBOX_WINDOW_VALUE_NAMES: ReadonlySet<string> = new Set([
  "setTimeout",
  "clearTimeout",
  "innerWidth",
  "innerHeight",
]);

export const NATIVE_SELF_BLUR_SINGLE_PARAMETER_COUNT = 1;
export const NATIVE_SELF_BLUR_ARGUMENT_COUNT = 0;
export const NATIVE_SELF_BLUR_REFUSED_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "ref",
  "is",
  "as",
  "asChild",
]);
export const NATIVE_SELF_BLUR_REFUSED_RUNTIME_NAMES: ReadonlySet<string> = new Set([
  "window",
  "Window",
  "self",
  "globalThis",
  "global",
  "document",
  "Document",
  "HTMLDocument",
  "HTMLElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "EventTarget",
  "Event",
  "MouseEvent",
  "FocusEvent",
  "PointerEvent",
  "ShadowRoot",
  "Object",
  "Reflect",
  "Function",
  "eval",
  "Proxy",
  "React",
  "parent",
  "top",
  "frames",
  "opener",
  "importScripts",
]);
export const NATIVE_SELF_BLUR_REFUSED_MEMBER_NAMES: ReadonlySet<string> = new Set([
  ...OBJECT_PROTOTYPE_PROPERTY_NAMES,
  "prototype",
  "call",
  "apply",
  "bind",
]);
export const NATIVE_SELF_BLUR_REFUSED_MODULE_SOURCES: ReadonlySet<string> = new Set([
  "vm",
  "node:vm",
  "module",
  "node:module",
]);

export const NATIVE_SELF_BLUR_TIMER_NAMES = new Set(["setTimeout", "setInterval"]);
export const NATIVE_SELF_BLUR_REFUSED_RUNTIME_TYPESCRIPT_NODES = new Set([
  "TSEnumDeclaration",
  "TSParameterProperty",
  "TSExportAssignment",
]);

export const TRACK_PLAYER_REPEAT_MODULE_SOURCE = "react-native-track-player";
export const TRACK_PLAYER_REPEAT_METHOD_NAME = "getRepeatMode";
export const TRACK_PLAYER_REPEAT_SUPPORTED_VERSION = "4.1.1";
export const TRACK_PLAYER_REPEAT_DECLARED_VERSION_PATTERN = /^[~^]?4\.1\.1$/u;
export const TRACK_PLAYER_REPEAT_SINGLE_COUNT = 1;
export const TRACK_PLAYER_REPEAT_EMPTY_COUNT = 0;
export const TRACK_PLAYER_REPEAT_FIRST_INDEX = 0;
export const TRACK_PLAYER_REPEAT_SECOND_INDEX = 1;
export const TRACK_PLAYER_REPEAT_BABEL_STATEMENT_COUNT = 2;
export const TRACK_PLAYER_REPEAT_REFUSED_MANIFEST_FIELDS = [
  "overrides",
  "resolutions",
  "pnpm",
  "browser",
  "imports",
  "babel",
  "react-native",
];
export const TRACK_PLAYER_REPEAT_CONFIG_NAMES = [
  "metro.config.js",
  "metro.config.cjs",
  "metro.config.mjs",
  "metro.config.ts",
  "webpack.config.js",
  "webpack.config.cjs",
  "webpack.config.mjs",
  ".babelrc.json5",
  "babel.config.json5",
];
export const TRACK_PLAYER_REPEAT_GLOBAL_CAPABILITIES = new Set([
  "NativeModules",
  "TurboModuleRegistry",
  "global",
  "globalThis",
  "window",
  "self",
  "Object",
  "Reflect",
  "Proxy",
  "Function",
  "eval",
  "require",
  "process",
  "__turboModuleProxy",
  "nativeModuleProxy",
]);
export const TRACK_PLAYER_REPEAT_NO_WILDCARD_INDEX = -1;
export const TRACK_PLAYER_REPEAT_INSTALLED_REFUSED_FIELDS = [
  "exports",
  "browser",
  "imports",
  "module",
  "overrides",
  "resolutions",
  "pnpm",
  "babel",
];
export const TRACK_PLAYER_REPEAT_COMPILER_PROVIDER_SOURCES = [
  "babel-preset-expo",
  "expo",
  "expo/tsconfig.base",
];
export const TRACK_PLAYER_REPEAT_SUPPORTED_SCRIPT_RECIPES: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  android: new Set(["expo run:android", "react-native run-android"]),
  ios: new Set(["expo run:ios", "react-native run-ios"]),
  start: new Set(["expo start", "expo start --android", "expo start --ios", "react-native start"]),
  lint: new Set(["eslint ."]),
  typecheck: new Set(["tsc --noEmit"]),
  test: new Set(["vitest", "vitest run"]),
  format: new Set(["prettier --write ."]),
  "format:check": new Set(["prettier --check ."]),
};
