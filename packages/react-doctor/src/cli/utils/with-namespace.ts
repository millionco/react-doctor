/**
 * Prefixes every key in a flat attribute group with `namespace.`, so a logical
 * group (scan config, diagnostics rollup, score, …) carries one dotted
 * namespace applied in a single place rather than hand-spelled into each key —
 * which is how the wide event drifted into a flat, half-namespaced soup. The
 * dotted prefix is what makes the attributes tree up in Sentry's attribute
 * browser and stay group-/filter-/aggregate-able in the Spans dataset.
 *
 * Value types are preserved verbatim (numbers stay numbers so Sentry infers a
 * numeric attribute and `p75(...)`/`avg(...)` work; `null` is kept so
 * `toSpanAttributes` can drop absent signals rather than coerce them).
 */
export const withNamespace = (
  namespace: string,
  attributes: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> => {
  const namespaced: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    namespaced[`${namespace}.${key}`] = value;
  }
  return namespaced;
};
