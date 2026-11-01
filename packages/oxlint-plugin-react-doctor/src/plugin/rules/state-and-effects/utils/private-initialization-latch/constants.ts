export const PRIVATE_LATCH_TUPLE_LENGTH = 2;
export const PRIVATE_LATCH_STATE_INDEX = 0;
export const PRIVATE_LATCH_SETTER_INDEX = 1;
export const PRIVATE_LATCH_INITIALIZER_ARGUMENT_COUNT = 1;
export const PRIVATE_LATCH_EFFECT_ARGUMENT_COUNT = 2;
export const PRIVATE_LATCH_EFFECT_PARAMETER_COUNT = 0;
export const PRIVATE_LATCH_REFERENCE_COUNT = 1;
export const PRIVATE_LATCH_UNSUPPORTED_PROGRAM_NODE_TYPES: ReadonlySet<string> = new Set([
  "WithStatement",
  "ImportExpression",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);
export const PRIVATE_LATCH_UNSUPPORTED_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "globalThis",
  "window",
  "global",
  "require",
  "module",
  "exports",
]);
export const PRIVATE_LATCH_UNSUPPORTED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
]);
