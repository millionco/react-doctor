export const PASSIVE_CALLBACK_ARGUMENT_COUNT = 2;
export const PASSIVE_CALLBACK_PARAMETER_COUNT = 1;
export const PASSIVE_CALLBACK_ARGUMENT_INDEX = 0;
export const PASSIVE_CALLBACK_DEPENDENCIES_ARGUMENT_INDEX = 1;
export const PASSIVE_CALLBACK_UNSUPPORTED_GLOBALS = new Set([
  "eval",
  "Function",
  "require",
  "module",
  "Event",
  "UIEvent",
  "MouseEvent",
  "WheelEvent",
  "TouchEvent",
]);
export const PASSIVE_CALLBACK_GLOBAL_NAMESPACES = new Set([
  "window",
  "globalThis",
  "self",
  "global",
]);
