import { parseDependencyVersion } from "./parse-dependency-version.js";
import type { ParsedVersion } from "./parse-dependency-version.js";

type RangeOperator = ">=" | ">" | "<=" | "<" | "^" | "~" | "=";

interface ParsedRange {
  operator: RangeOperator;
  bound: ParsedVersion;
}

const RANGE_PATTERN = /^\s*(>=|<=|>|<|\^|~|=)?\s*v?(\d+)(?:\.(\d+))?/;

const parseRange = (range: string): ParsedRange | null => {
  const match = RANGE_PATTERN.exec(range);
  if (!match) return null;
  const operator = (match[1] ?? ">=") as RangeOperator;
  const major = Number(match[2]);
  const minor = match[3] === undefined ? 0 : Number(match[3]);
  if (!Number.isFinite(major)) return null;
  return { operator, bound: { major, minor } };
};

const compare = (left: ParsedVersion, right: ParsedVersion): number =>
  left.major !== right.major ? left.major - right.major : left.minor - right.minor;

// Tests whether an installed version satisfies a query range. Only major /
// minor precision is modeled — that is all the rule capability gates need
// (`react:19`, `tailwind:3.4`). A bare query (`"19"`) means `">=19"` so
// `hasDependency("react", "19")` reads naturally as "React 19 or newer".
export const versionSatisfiesRange = (
  installed: ParsedVersion | string | null | undefined,
  range: string,
): boolean => {
  const installedVersion =
    typeof installed === "string" ? parseDependencyVersion(installed) : installed;
  if (!installedVersion) return false;

  const parsed = parseRange(range);
  if (!parsed) return false;

  const { operator, bound } = parsed;
  const ordering = compare(installedVersion, bound);

  switch (operator) {
    case ">":
      return ordering > 0;
    case ">=":
      return ordering >= 0;
    case "<":
      return ordering < 0;
    case "<=":
      return ordering <= 0;
    case "=":
      return ordering === 0;
    case "^":
      return installedVersion.major === bound.major && ordering >= 0;
    case "~":
      return installedVersion.major === bound.major && installedVersion.minor >= bound.minor;
  }
};
