import * as fs from "node:fs";
import { parseJSONC } from "confbox";
import { isPlainObject } from "./project-info/index.js";

const EXTENDS_LOCAL_PATH_PREFIXES = ["./", "../", "/"];

const isLocalPathExtend = (entry: string): boolean => {
  for (const prefix of EXTENDS_LOCAL_PATH_PREFIXES) {
    if (entry.startsWith(prefix)) return true;
  }
  return false;
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
    parsed = parseJSONC<unknown>(raw, { allowTrailingComma: true });
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
