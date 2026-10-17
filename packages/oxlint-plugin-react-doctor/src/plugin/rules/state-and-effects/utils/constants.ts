export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;
export const IMPERATIVE_COMMAND_SINGLE_FRAME_COUNT = 1;
export const IMPERATIVE_COMMAND_ADJACENT_OFFSETS = [-1, 1];
export const IMPERATIVE_COMMAND_PROVIDER_HAZARD_NAMES = [
  "React",
  "eval",
  "Function",
  "require",
  "module",
  "Object",
  "Reflect",
];
export const IMPERATIVE_COMMAND_UNSUPPORTED_FRAME_NODES = new Set([
  "TryStatement",
  "SwitchStatement",
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "WhileStatement",
  "DoWhileStatement",
  "LabeledStatement",
  "BreakStatement",
  "ContinueStatement",
  "ThisExpression",
]);

export const NATIVE_TRANSITION_TUPLE_ELEMENT_COUNT = 2;
export const NATIVE_TRANSITION_ACTION_INDEX = 1;
export const NATIVE_TRANSITION_CALL_ARGUMENT_COUNT = 1;
export const NATIVE_TRANSITION_TUPLE_PROVIDER_NAMES = ["Array", "Symbol"];

export const NATIVE_TRANSITION_GLOBAL_CARRIER_PROPERTY_NAMES = new Set([
  "global",
  "globalThis",
  "self",
  "window",
  "frames",
  "parent",
  "top",
  "opener",
]);
