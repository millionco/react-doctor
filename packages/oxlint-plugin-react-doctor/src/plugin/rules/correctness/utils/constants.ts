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
