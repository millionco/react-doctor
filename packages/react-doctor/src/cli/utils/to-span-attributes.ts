/**
 * Converts a Sentry tag map (which permits `null` to denote an absent signal)
 * into Sentry/OTel span attributes, which only accept primitives. `null` values
 * are dropped rather than coerced, so an absent signal doesn't become a
 * misleading `"null"` attribute.
 */
export const toSpanAttributes = (
  tags: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean> => {
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value !== null) attributes[key] = value;
  }
  return attributes;
};
