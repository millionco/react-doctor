export const MAX_RETURNED_SETTER_EXPRESSIONS = 64;

export const DISABLING_STATE_TUPLE_SLOT_COUNT = 2;
export const DISABLING_STATE_SETTER_NAME_PATTERN = /disabling/i;

export const DISABLING_STATE_UNSUPPORTED_PROVIDER_GLOBAL_NAMES = new Set([
  "React",
  "require",
  "module",
  "eval",
  "Function",
  "globalThis",
  "window",
  "self",
  "global",
]);
