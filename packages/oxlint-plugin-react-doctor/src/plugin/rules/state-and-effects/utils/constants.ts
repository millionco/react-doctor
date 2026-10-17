export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const PLATFORM_SUBSCRIPTION_ARGUMENT_COUNT = 2;
export const PLATFORM_SUBSCRIPTION_OS_VALUES = new Set(["ios", "android"]);
export const PLATFORM_SUBSCRIPTION_NATIVE_METHODS = new Set(["setState", "forceUpdate"]);
export const PLATFORM_SUBSCRIPTION_EXPOSED_GLOBALS = new Set([
  "React",
  "Object",
  "Reflect",
  "Array",
  "Proxy",
  "eval",
  "Function",
  "module",
  "global",
  "globalThis",
  "window",
  "self",
]);
export const PLATFORM_SUBSCRIPTION_EXPOSED_PROPERTIES = new Set(["constructor", "__proto__"]);
export const PLATFORM_SUBSCRIPTION_ASSET_PATTERN = /^\.{1,2}\/.+\.(?:png|jpe?g|gif|webp)$/i;

export const PLATFORM_SUBSCRIPTION_ASSET_ARGUMENT_COUNT = 1;
export const PLATFORM_SUBSCRIPTION_BIND_ARGUMENT_COUNT = 1;
export const PLATFORM_SUBSCRIPTION_HELPER_STATEMENT_COUNT = 1;
export const PLATFORM_SUBSCRIPTION_REACT_MAX_ARGUMENT_COUNT = 2;

export const PLATFORM_SUBSCRIPTION_UNSUPPORTED_TS_RUNTIME_TYPES = new Set([
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
]);
