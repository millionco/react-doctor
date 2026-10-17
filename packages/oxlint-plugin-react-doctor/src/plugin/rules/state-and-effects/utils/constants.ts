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
