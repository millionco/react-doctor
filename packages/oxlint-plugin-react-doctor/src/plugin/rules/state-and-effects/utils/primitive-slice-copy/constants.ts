export const FRESH_SLICE_UPDATER_STATEMENT_COUNT = 3;
export const NATIVE_SLICE_MAX_ARGUMENT_COUNT = 2;
export const SINGLE_ARGUMENT_COUNT = 1;
export const SINGLE_BINDING_COUNT = 1;
export const SINGLE_PARAMETER_COUNT = 1;
export const STATE_PAIR_ELEMENT_COUNT = 2;
export const PRIMITIVE_ARRAY_ELEMENT_TYPES = new Map([
  ["TSStringKeyword", "string"],
  ["TSNumberKeyword", "number"],
  ["TSBooleanKeyword", "boolean"],
]);
export const READONLY_REACT_DEPENDENCY_HOOKS = new Set(["useMemo", "useCallback", "useEffect"]);
export const ARRAY_INTEGRITY_GLOBAL_NAMES = new Set([
  "Array",
  "Object",
  "Reflect",
  "Symbol",
  "Function",
  "eval",
  "globalThis",
  "window",
  "self",
  "global",
  "document",
]);
export const ARRAY_PROVIDER_PROPERTY_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "__lookupGetter__",
  "__lookupSetter__",
  "__defineGetter__",
  "__defineSetter__",
]);
export const READONLY_ARRAY_STATIC_METHODS = new Set(["from", "isArray"]);
export const EVALUATED_TYPESCRIPT_NODE_TYPES = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);
