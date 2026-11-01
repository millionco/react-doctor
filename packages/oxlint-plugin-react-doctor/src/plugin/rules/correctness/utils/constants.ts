export const FIRST_SPLIT_PART_INDEX = 0;
export const FIRST_OPTIONAL_SPLIT_PART_INDEX = 1;

export const MAX_RESOURCE_KEY_FACTORY_DEPTH = 2;

export const RESOURCE_KEY_UNSUPPORTED_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "Object",
  "Reflect",
  "eval",
  "Function",
  "require",
  "module",
  "global",
  "globalThis",
  "window",
  "self",
  "frames",
  "parent",
  "top",
  "opener",
]);

export const RESOURCE_KEY_REFLECTION_PROPERTIES: ReadonlySet<string> = new Set([
  "constructor",
  "__proto__",
]);

export const RESOURCE_KEY_STACK_LAYOUT_PROPERTIES: ReadonlySet<string> = new Set([
  "direction",
  "spacing",
]);

export const RESOURCE_KEY_THEME_PROPERTIES: ReadonlySet<string> = new Set([
  "MuiStack",
  "defaultProps",
]);
