export const FETCH_ERROR_PAYLOAD_RESTRICTED_ANCESTOR_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "SwitchCase",
  "CatchClause",
]);

export const FETCH_ERROR_PAYLOAD_RUNTIME_TYPESCRIPT_TYPES = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);

export const FETCH_ERROR_PAYLOAD_GLOBAL_CARRIER_NAMES = new Set([
  "globalThis",
  "window",
  "self",
  "global",
]);

export const FETCH_ERROR_PAYLOAD_GLOBAL_CARRIER_PROPERTIES = new Set([
  "globalThis",
  "window",
  "self",
  "global",
  "require",
  "eval",
]);

export const FETCH_ERROR_PAYLOAD_REQUIRE_CARRIER_PROPERTIES = new Set([
  "call",
  "apply",
  "bind",
  "cache",
  "main",
  "extensions",
]);
