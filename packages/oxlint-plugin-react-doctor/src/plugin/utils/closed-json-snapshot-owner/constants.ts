export const CLOSED_JSON_SNAPSHOT_ROUTE_PROP_NAMES: ReadonlySet<string> = new Set([
  "history",
  "location",
  "match",
  "staticContext",
]);
export const CLOSED_JSON_SNAPSHOT_PROTOTYPE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export const CLOSED_JSON_SNAPSHOT_APPLICATION_SUCCESS_VALUES: ReadonlySet<unknown> = new Set([
  0,
  true,
  "success",
  200,
]);
