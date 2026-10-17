export const EMPTY_ARGUMENT_COUNT = 0;
export const SINGLE_ARGUMENT_COUNT = 1;
export const RECORD_FIELD_COUNT = 2;
export const REMOVAL_STATEMENT_COUNT = 4;
export const CANCEL_STATEMENT_COUNT = 5;
export const RESET_STATEMENT_COUNT = 3;
export const RUNTIME_DECLARATION_TYPES: ReadonlySet<string> = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "WithStatement",
]);
export const NATIVE_PROVIDER_NAMES: ReadonlySet<string> = new Set([
  "Map",
  "Set",
  "AbortController",
  "Function",
  "globalThis",
  "global",
  "window",
]);
export const REFLECTION_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "setPrototypeOf",
  "defineProperty",
  "defineProperties",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
