export const NATIVE_KEYS_CALL_ARGUMENT_COUNT = 1;
export const NATIVE_KEYS_ITERATION_ARGUMENT_COUNT = 1;
export const NATIVE_KEYS_FOR_OF_DECLARATION_COUNT = 1;
export const NATIVE_KEYS_ITERATION_METHOD_NAMES = new Set(["map", "every"]);
export const NATIVE_KEYS_UNSUPPORTED_PROGRAM_NODE_TYPES = new Set([
  "WithStatement",
  "ImportExpression",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
]);
export const NATIVE_KEYS_UNSUPPORTED_GLOBAL_NAMES = new Set(["eval", "Function", "Reflect"]);
export const NATIVE_KEYS_UNSUPPORTED_PROPERTY_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);
