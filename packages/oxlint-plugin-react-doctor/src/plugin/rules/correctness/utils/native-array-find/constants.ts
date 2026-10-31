export const FIND_METHOD_NAMES = new Set(["find", "findLast"]);
export const PROVIDER_KEYS = new Set([
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "constructor",
  "prototype",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "getPrototypeOf",
  "Array",
  "Object",
  "Reflect",
  "Proxy",
  "Function",
  "eval",
]);
export const DYNAMIC_PROVIDER_NAMES = new Set([
  "Array",
  "Object",
  "Reflect",
  "eval",
  "Function",
  "Proxy",
  "require",
]);
export const RUNTIME_TYPESCRIPT_PROVIDER_NODES = new Set([
  "TSEnumDeclaration",
  "TSParameterProperty",
  "TSExportAssignment",
  "TSImportEqualsDeclaration",
  "TSModuleDeclaration",
]);
export const REPEATED_FIND_GUARD_METHOD_NAMES = new Set([
  ...FIND_METHOD_NAMES,
  "some",
  "findIndex",
]);
export const REPEATED_FIND_SINGLE_ITEM_COUNT = 1;
export const REPEATED_FIND_COUNTER_INITIAL_VALUE = 0;
export const REPEATED_FIND_COUNTER_MATCH_VALUE = 1;
