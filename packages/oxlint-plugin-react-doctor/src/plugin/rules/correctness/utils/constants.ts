export const GUARDED_MAP_GET_ARGUMENT_COUNT = 1;
export const GUARDED_MAP_SET_ARGUMENT_COUNT = 2;
export const GUARDED_MAP_CALLBACK_PARAMETER_LIMIT = 2;
export const GUARDED_MAP_KEY_ARGUMENT_INDEX = 0;
export const GUARDED_MAP_EMPTY_ARGUMENT_COUNT = 0;
export const GUARDED_MAP_METHOD_NAMES = new Set(["get", "set", "has", "forEach"]);

export const GUARDED_MAP_DYNAMIC_PROVIDER_NAMES = new Set(["eval", "Function"]);

export const GUARDED_MAP_ERASED_PROVIDER_NAMES = new Set([
  ...GUARDED_MAP_DYNAMIC_PROVIDER_NAMES,
  "Map",
  "Array",
  "globalThis",
  "window",
  "self",
  "global",
]);
export const LOCAL_FORMATTER_ARGUMENT_COUNT = 1;

export const STRING_STATE_TUPLE_LENGTH = 2;
export const STRING_STATE_TUPLE_PROVIDER_NAMES = ["Array", "Symbol", "Object", "Reflect"];

export const SINGLE_LITERAL_STAR_PATTERN =
  /^(?:\^[A-Za-z0-9 :,_#@%&=;!~]\*|[A-Za-z0-9 :,_#@%&=;!~]\*\$)$/;

export const NON_STATEFUL_REGEX_FLAGS = /^[dimsuv]*$/;

export const SINGLE_REGEX_ARGUMENT_COUNT = 1;

export const SINGLE_SELECTED_TYPE_PROPERTY_COUNT = 1;

export const REGEX_RESULT_PROVIDER_NAMES = ["String", "RegExp"];

export const REGEX_GLOBAL_EXPOSED_PROPERTY_NAMES = new Set([
  ...REGEX_RESULT_PROVIDER_NAMES,
  "window",
  "globalThis",
  "self",
  "global",
  "constructor",
  "__proto__",
  "prototype",
]);

export const FIRST_DELIMITED_PART_INDEX = 1;

export const MISSING_DELIMITER_POSITION = -1;

export const SINGLE_DELIMITER_ARGUMENT_COUNT = 1;

export const NO_ARGUMENTS_COUNT = 0;

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

export const NATIVE_LOCATION_QUERY_PART_INDEX = 1;

export const NATIVE_LOCATION_SPLIT_ARGUMENT_COUNT = 1;

export const NATIVE_LOCATION_PROTECTED_REFERENCE_NAMES = new Set([
  "document",
  "top",
  "parent",
  "opener",
  "frames",
  "String",
  "Symbol",
  "Reflect",
  "globalThis",
  "global",
  "self",
  "location",
  "eval",
  "Function",
  "require",
]);

export const NATIVE_LOCATION_FORBIDDEN_PROPERTY_NAMES = new Set([
  "defaultView",
  "contentWindow",
  "ownerDocument",
  "prototype",
  "__proto__",
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
  "String",
  "Symbol",
  "Reflect",
  "globalThis",
  "global",
  "self",
  "window",
  "eval",
  "Function",
]);

export const NATIVE_LOCATION_RUNTIME_TYPESCRIPT_NODE_TYPES = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
]);

export const NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT = 0;

export const NATIVE_SUBMIT_HANDLER_PARAMETER_COUNT = 1;

export const NATIVE_SUBMIT_ATTRIBUTE_COUNT = 1;

export const NATIVE_SUBMIT_PROVIDER_MODULES: ReadonlySet<string> = new Set([
  "react",
  "react-router",
  "react-router-dom",
]);

export const NATIVE_SUBMIT_UNSUPPORTED_GLOBALS: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "require",
  "globalThis",
  "global",
  "window",
  "self",
  "arguments",
]);

export const NATIVE_SUBMIT_RUNTIME_TYPESCRIPT_NODES: ReadonlySet<string> = new Set([
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
]);

export const NATIVE_SUBMIT_MODULE_ARGUMENT_COUNT = 1;

export const EDITABLE_POSITION_SINGLE_COUNT = 1;

export const EDITABLE_POSITION_PAIR_COUNT = 2;

export const EDITABLE_POSITION_CHARACTER_COUNT = 1;

export const EDITABLE_POSITION_LABEL_OFFSET_COUNT = 1;

export const EDITABLE_POSITION_REFLECTION_PROPERTIES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "caller",
  "callee",
]);

export const EDITABLE_POSITION_UNSUPPORTED_CALLS = new Set(["eval", "Function", "require"]);

export const EDITABLE_POSITION_UNSUPPORTED_GLOBALS = new Set([
  "Array",
  "module",
  "process",
  "Reflect",
  "Object",
  "globalThis",
  "window",
  "global",
  "self",
]);

export const EDITABLE_POSITION_UNSUPPORTED_MODULES = new Set([
  "module",
  "node:module",
  "process",
  "node:process",
  "vm",
  "node:vm",
  "repl",
  "node:repl",
  "inspector",
  "node:inspector",
  "inspector/promises",
  "node:inspector/promises",
  "preact",
  "preact/hooks",
  "preact/compat",
]);
