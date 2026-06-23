// Defensive coercion for untrusted transcript JSON. Every agent source parses
// data the user didn't write by hand, so values are narrowed before use rather
// than trusted. Shared by the Claude/Codex/Cursor adapters.

/** Narrow an unknown to a non-empty string, else undefined. */
export const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Narrow an unknown to a string, preserving the empty string (unlike `asString`). */
export const asNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** Narrow an unknown to a plain object record, else undefined. */
export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Narrow an unknown to an array, else an empty array. */
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Parse a JSON string, returning undefined on non-strings or parse errors. */
export const parseJson = (raw: string | null | undefined): unknown => {
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};
