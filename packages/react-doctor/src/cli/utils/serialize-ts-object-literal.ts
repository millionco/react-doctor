import { isPlainObject } from "@react-doctor/core";

// A key that can appear unquoted in a TS object literal. Anything else
// (e.g. "react-doctor/no-danger") is quoted via JSON.stringify.
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const INDENT_UNIT = "  ";

const serializeKey = (key: string): string =>
  SAFE_IDENTIFIER_PATTERN.test(key) ? key : JSON.stringify(key);

/**
 * Serializes a JSON-compatible value as an idiomatic TypeScript literal:
 * identifier-shaped object keys stay unquoted, two-space indented, no blank
 * lines. Intended for JSON-sourced config values (string / number / boolean /
 * null / array / plain object); any other type falls back to its JSON form.
 */
export const serializeTsObjectLiteral = (value: unknown, depth = 0): string => {
  const indent = INDENT_UNIT.repeat(depth);
  const childIndent = INDENT_UNIT.repeat(depth + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value
      .map((item) => `${childIndent}${serializeTsObjectLiteral(item, depth + 1)}`)
      .join(",\n");
    return `[\n${items}\n${indent}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    const entries = keys
      .map(
        (key) =>
          `${childIndent}${serializeKey(key)}: ${serializeTsObjectLiteral(value[key], depth + 1)}`,
      )
      .join(",\n");
    return `{\n${entries}\n${indent}}`;
  }

  return JSON.stringify(value);
};
