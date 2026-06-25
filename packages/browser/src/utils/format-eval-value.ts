// Render an `evaluate`/`inspect` result for display: strings pass through as-is,
// everything else is pretty-printed JSON. Callers handle the empty (undefined /
// null) case themselves, since each surface signals "no value" differently.
export const formatEvalValue = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);
