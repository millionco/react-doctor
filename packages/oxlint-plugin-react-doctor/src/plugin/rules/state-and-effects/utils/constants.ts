export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const DOCUMENT_LISTENER_UNSUPPORTED_ROOT_NAMES: ReadonlySet<string> = new Set([
  "window",
  "self",
  "globalThis",
  "global",
  "eval",
  "Function",
  "Object",
  "Reflect",
  "require",
  "module",
]);

export const DOCUMENT_LISTENER_UNSUPPORTED_MEMBERS: ReadonlySet<string> = new Set([
  ...DOCUMENT_LISTENER_UNSUPPORTED_ROOT_NAMES,
  "document",
  "getBuiltinModule",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "assign",
  "set",
  "deleteProperty",
  "dispatchEvent",
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
]);

export const DOCUMENT_LISTENER_UNSUPPORTED_NODES: ReadonlySet<string> = new Set([
  "WithStatement",
  "ImportExpression",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSEnumDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
  "Decorator",
]);

export const DOCUMENT_LISTENER_METHOD_NAMES: ReadonlySet<string> = new Set([
  "addEventListener",
  "removeEventListener",
]);

export const DOCUMENT_LISTENER_WITNESS_REFERENCE_COUNT = 2;
