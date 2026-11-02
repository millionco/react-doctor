export const COOKIE_GLOBAL_OBJECT_NAMES = new Set(["globalThis", "window", "self"]);
export const COOKIE_NATIVE_PROVIDER_NAMES = new Set([
  "document",
  "Document",
  "HTMLDocument",
  "encodeURIComponent",
]);
export const UNSUPPORTED_COOKIE_RUNTIME_NODES = new Set([
  "ImportExpression",
  "TSEnumDeclaration",
  "TSEnumBody",
  "TSEnumMember",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);
export const COOKIE_ARITHMETIC_OPERATORS = new Set(["+", "-", "*", "/", "%", "**"]);

export const COOKIE_EXPORT_CAPABILITY_NAMES = new Set(["module", "exports"]);

export const DYNAMIC_PROVIDER_NAMES = new Set(["eval", "Function", "Proxy", "Reflect"]);
export const DYNAMIC_PROVIDER_KEYS = new Set([
  "constructor",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "eval",
  "Function",
  "Proxy",
  "Reflect",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
]);
