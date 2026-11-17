export const INTERVAL_REGISTRATION_ARGUMENT_COUNT = 2;
export const INTERVAL_CALLBACK_ARGUMENT_INDEX = 0;
export const INTERVAL_DELAY_ARGUMENT_INDEX = 1;
export const INTERVAL_CLEANUP_ARGUMENT_COUNT = 1;
export const INTERVAL_SINGLE_BINDING_COUNT = 1;
export const INTERVAL_STATE_DISPATCHER_INDEX = 1;
export const INTERVAL_STATE_TUPLE_COUNT = 2;
export const INTERVAL_ZERO_PARAMETER_COUNT = 0;
export const INTERVAL_EFFECT_TRAILING_STATEMENT_COUNT = 2;
export const INTERVAL_HANDLE_REFERENCE_COUNT = 1;

export const INTERVAL_STATE_HOOK_NAMES = new Set(["useState", "useReducer"]);
export const INTERVAL_NATIVE_CALL_NAMES = new Set(["setInterval", "clearInterval"]);
export const INTERVAL_GLOBAL_CARRIER_NAMES = new Set(["globalThis", "window", "self", "global"]);
export const INTERVAL_REFLECTIVE_GLOBAL_NAMES = new Set(["eval", "Function", "Reflect"]);
export const INTERVAL_NATIVE_FACTORY_NAMES = new Set([
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
]);
export const INTERVAL_UNSUPPORTED_PROPERTY_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
]);
export const INTERVAL_RUNTIME_TS_NODE_TYPES = new Set([
  "TSImportEqualsDeclaration",
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSDeclareFunction",
]);
export const INTERVAL_ERASED_SYMBOL_KINDS = new Set(["ts-type-alias", "ts-interface", "ts-module"]);
