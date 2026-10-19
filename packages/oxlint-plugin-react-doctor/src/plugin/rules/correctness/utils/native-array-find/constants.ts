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
