/**
 * Lowercase, key-safe form of a rule category for the `diag.category.*`
 * telemetry attribute namespace (categories carry spaces / capitals, e.g.
 * "Performance" → `performance`, "Dead Code" → `dead_code`). Shared by the
 * CLI run event and the editor LSP wide event so both namespace identically.
 */
export const toCategoryKey = (category: string): string =>
  category.toLowerCase().replace(/[^a-z0-9]+/g, "_");
