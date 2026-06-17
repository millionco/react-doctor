// Narrows an unknown value to a string-keyed object (excludes null and
// arrays) for safe property access when decoding loosely-typed JSON.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
