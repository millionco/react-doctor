import fs from "node:fs";
import { isPlainObject } from "./is-plain-object.js";

const EXTENDS_LOCAL_PATH_PREFIXES = ["./", "../", "/"];

const isLocalPathExtend = (entry: string): boolean => {
  for (const prefix of EXTENDS_LOCAL_PATH_PREFIXES) {
    if (entry.startsWith(prefix)) return true;
  }
  return false;
};

// HACK: ESLint's JSON config files in the wild are routinely JSONC —
// `//` line comments and `/* */` block comments. Strict `JSON.parse`
// throws on them. Strip both forms (avoiding matches inside string
// literals) so the extends pre-screen still works on real Next.js /
// CRA / TypeScript scaffolds.
const stripJsoncComments = (raw: string): string => {
  let result = "";
  let cursor = 0;
  let inString = false;
  let stringQuote = "";
  while (cursor < raw.length) {
    const character = raw[cursor];
    const nextCharacter = raw[cursor + 1];
    if (inString) {
      result += character;
      if (character === "\\" && cursor + 1 < raw.length) {
        result += nextCharacter;
        cursor += 2;
        continue;
      }
      if (character === stringQuote) inString = false;
      cursor += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      inString = true;
      stringQuote = character;
      result += character;
      cursor += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      const lineEndIndex = raw.indexOf("\n", cursor);
      cursor = lineEndIndex === -1 ? raw.length : lineEndIndex;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      const blockEndIndex = raw.indexOf("*/", cursor + 2);
      cursor = blockEndIndex === -1 ? raw.length : blockEndIndex + 2;
      continue;
    }
    result += character;
    cursor += 1;
  }
  return result;
};

const parseJsonOrJsonc = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(stripJsoncComments(raw));
  }
};

// HACK: oxlint's `extends` resolver only handles local file paths and
// other oxlint configs — bare-package extends (`"next"`, `"airbnb"`,
// `"plugin:@typescript-eslint/recommended"`) crash the parser with
// "Failed to parse oxlint configuration file". The crash drops every
// adopted rule AND emits a misleading stderr warning that suggests the
// user's ESLint config is broken when it's just incompatible-by-design.
//
// We pre-screen the file: if it's an `.eslintrc.json` whose `extends`
// is non-empty and contains ONLY bare-package references, oxlint can't
// adopt it — drop it from the extends list silently. Configs with no
// `extends`, or with at least one local path, still go through (oxlint
// can resolve local extends and tolerate unknown rules within them).
export const canOxlintExtendConfig = (configPath: string): boolean => {
  if (!configPath.endsWith(".eslintrc.json")) return true;

  let parsed: unknown;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    parsed = parseJsonOrJsonc(raw);
  } catch {
    return true;
  }

  if (!isPlainObject(parsed)) return true;

  const extendsValue = parsed.extends;
  if (extendsValue === undefined || extendsValue === null) return true;

  const extendsEntries = Array.isArray(extendsValue) ? extendsValue : [extendsValue];
  if (extendsEntries.length === 0) return true;

  const hasAnyLocalExtend = extendsEntries.some(
    (entry) => typeof entry === "string" && isLocalPathExtend(entry),
  );
  return hasAnyLocalExtend;
};
