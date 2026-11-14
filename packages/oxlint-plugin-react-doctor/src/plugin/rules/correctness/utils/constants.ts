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
