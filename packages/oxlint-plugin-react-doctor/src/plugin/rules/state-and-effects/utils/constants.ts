export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const NATIVE_EMITTER_ARGUMENT_COUNT = 2;
export const NATIVE_EMITTER_EXPOSED_GLOBAL_NAMES = new Set([
  "global",
  "globalThis",
  "Object",
  "Reflect",
  "eval",
  "Function",
  "require",
  "module",
]);
export const NATIVE_EMITTER_EXPOSED_PROPERTY_NAMES = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
export const NATIVE_EMITTER_UNSUPPORTED_CLEANUP_TYPES = new Set([
  "TryStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "LabeledStatement",
  "BreakStatement",
  "ContinueStatement",
]);

export const NATIVE_EMITTER_MODULE_CARRIER_NAMES = new Set(["module", "node:module"]);

export const NATIVE_EMITTER_INHERITED_REACT_METHOD_NAMES = new Set(["setState", "forceUpdate"]);

export const NATIVE_EMITTER_REACT_MAX_ARGUMENT_COUNT = 2;
