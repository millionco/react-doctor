export const CLOSED_JSON_SNAPSHOT_TRANSFORM_MAX_NODES = 16384;
export const CLOSED_JSON_SNAPSHOT_TRANSFORM_MAX_SCOPE_DEPTH = 64;
export const CLOSED_JSON_SNAPSHOT_TRANSFORM_NATIVE_NAMES: ReadonlySet<string> = new Set([
  "Object",
  "Array",
  "Symbol",
  "Function",
  "Reflect",
  "Promise",
  "JSON",
  "XMLHttpRequest",
]);
