export const PRIMITIVE_SPLIT_CHILD_ARGUMENT_COUNT = 1;
export const PRIMITIVE_SPLIT_CHILD_CALLBACK_PARAMETER_COUNT = 2;
export const PRIMITIVE_SPLIT_CHILD_FIRST_INDEX = 0;
export const PRIMITIVE_SPLIT_CHILD_RANGE_END_INDEX = 1;
export const PRIMITIVE_SPLIT_CHILD_UNSUPPORTED_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "String",
  "Array",
  "Object",
  "Reflect",
  "Symbol",
  "Function",
  "eval",
  "arguments",
  "globalThis",
  "window",
  "self",
  "global",
  "document",
]);
export const PRIMITIVE_SPLIT_CHILD_RUNTIME_TYPESCRIPT_NODES: ReadonlySet<string> = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);
export const PRIMITIVE_SPLIT_CHILD_DICTIONARY_MINIMUM_ENTRIES = 1;
export const PRIMITIVE_SPLIT_CHILD_PROVIDER_EXPOSURE_PROPERTIES: ReadonlySet<string> = new Set([
  "prototype",
  "constructor",
  "__proto__",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "__lookupGetter__",
  "__lookupSetter__",
  "__defineGetter__",
  "__defineSetter__",
]);
