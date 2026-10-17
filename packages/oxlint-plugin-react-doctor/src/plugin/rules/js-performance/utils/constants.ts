export const STRUCTURED_CLONE_GLOBAL_OBJECT_NAMES = new Set([
  "global",
  "globalThis",
  "window",
  "self",
]);
export const STRUCTURED_CLONE_PROVIDER_NAMES = new Set([
  "document",
  "global",
  "globalThis",
  "window",
  "self",
  "jest",
  "JSON",
  "structuredClone",
  "eval",
  "Function",
]);
export const STRUCTURED_CLONE_GLOBAL_EXPOSURE_NAMES = new Set([
  "document",
  "global",
  "globalThis",
  "window",
  "self",
  "constructor",
  "prototype",
  "structuredClone",
  "jest",
  "JSON",
  "eval",
  "Function",
  "top",
  "parent",
  "frames",
]);

export const STRUCTURED_CLONE_SMALL_BRANCH_COUNT = 2;
export const STRUCTURED_CLONE_LARGE_BRANCH_COUNT = 64;
