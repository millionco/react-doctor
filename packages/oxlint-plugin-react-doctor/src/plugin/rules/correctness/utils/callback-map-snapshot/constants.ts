export const SNAPSHOT_STATEMENT_COUNT = 3;
export const SINGLE_VALUE_COUNT = 1;
export const NO_VALUE_COUNT = 0;
export const SNAPSHOT_ACTION_COUNT = 3;
export const UNSUPPORTED_PROVIDER_SELECTORS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "defineProperty",
  "defineProperties",
  "__lookupGetter__",
  "__lookupSetter__",
  "__defineGetter__",
  "__defineSetter__",
]);
export const UNSUPPORTED_PROVIDER_GLOBALS: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "globalThis",
  "window",
  "self",
  "global",
]);
export const UNSUPPORTED_RUNTIME_TYPES: ReadonlySet<string> = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
  "WithStatement",
]);
export const GUARDED_CALLBACK_STATEMENT_COUNT = 1;
export const GUARDED_ATTACH_STATEMENT_COUNT = 2;
