export const EMPTY_COLLECTOR_COUNT = 0;
export const SINGLE_COLLECTOR_CALLBACK_COUNT = 1;
export const MAX_COLLECTOR_REGISTER_STATEMENTS = 2;
export const COLLECTOR_DRAIN_START_INDEX = 0;
export const COLLECTOR_UNSUPPORTED_GLOBAL_NAMES = new Set([
  "Array",
  "Object",
  "Reflect",
  "Function",
  "eval",
  "globalThis",
  "window",
  "self",
  "global",
  "require",
  "module",
  "process",
]);
export const COLLECTOR_UNSUPPORTED_EXECUTION_DEPENDENCIES = new Set([
  "vm",
  "node:vm",
  "module",
  "node:module",
]);
export const COLLECTOR_UNSUPPORTED_MEMBER_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "caller",
  "callee",
  "eval",
]);
