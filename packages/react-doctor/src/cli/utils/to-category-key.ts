/**
 * Lowercase, key-safe form of a rule category for the `diag.category.*`
 * telemetry attribute namespace (categories carry spaces / capitals, e.g.
 * "Performance" → `performance`, "Dead Code" → `dead_code`).
 */
export const toCategoryKey = (category: string): string =>
  category.toLowerCase().replace(/[^a-z0-9]+/g, "_");
