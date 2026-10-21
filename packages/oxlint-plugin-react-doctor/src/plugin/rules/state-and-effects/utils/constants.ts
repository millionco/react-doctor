export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const SDK_SNAPSHOT_SUPPORTED_VERSION = {
  major: 2,
  minor: 34,
  patch: 0,
  isPrerelease: false,
};
export const SDK_SNAPSHOT_DECLARED_RANGE = "^2.34.0";
export const SDK_SNAPSHOT_UNSUPPORTED_IDENTIFIERS = new Set([
  "eval",
  "Function",
  "require",
  "React",
  "Twilio",
  "EventEmitter",
  "Reflect",
  "Object",
  "globalThis",
  "global",
  "window",
  "self",
  "arguments",
  "module",
]);
export const SDK_SNAPSHOT_UNSUPPORTED_MEMBERS = new Set([
  "React",
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);
export const SDK_SNAPSHOT_RUNTIME_TYPESCRIPT_NODES = new Set([
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumMember",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
]);
