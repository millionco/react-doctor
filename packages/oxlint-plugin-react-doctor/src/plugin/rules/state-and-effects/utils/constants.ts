export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const SLATE_CURRENT_FOCUS_SUPPORTED_VERSION = {
  major: 0,
  minor: 126,
  patch: 0,
  isPrerelease: false,
};
export const SLATE_CURRENT_FOCUS_DECLARED_RANGE = "^0.126.0";
export const SLATE_CURRENT_FOCUS_UNSUPPORTED_IDENTIFIERS = new Set([
  "eval",
  "Function",
  "require",
  "Reflect",
  "globalThis",
  "global",
  "window",
  "self",
  "module",
  "arguments",
]);
export const SLATE_CURRENT_FOCUS_UNSUPPORTED_MEMBERS = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);
export const SLATE_CURRENT_FOCUS_RUNTIME_TYPESCRIPT_NODES = new Set([
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumMember",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
]);
