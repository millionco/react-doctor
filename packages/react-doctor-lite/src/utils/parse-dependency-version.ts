export interface ParsedVersion {
  major: number;
  minor: number;
}

// Matches a whole semver-ish token (`major[.minor[.patch]]`) so the patch
// segment of `"19.0.0"` is consumed rather than mistaken for a second, lower
// "version" of `0`. Multi-token ranges (`">=18 <20"`) still yield one match
// per comparator.
const VERSION_TOKEN_PATTERN = /(\d+)(?:\.(\d+))?(?:\.\d+)?/g;

// Parses an installed dependency spec (e.g. `"^19.2.0"`, `">=18 <20"`,
// `"19"`) down to the LOWEST major it could resolve to, plus that major's
// minor. Non-concrete specs (`"workspace:*"`, `"catalog:"`, `"latest"`,
// `"*"`) yield `null`. Picking the lowest major keeps range gating
// conservative — a `">=18 <20"` peer range reports as React 18, never 19.
export const parseDependencyVersion = (spec: string | null | undefined): ParsedVersion | null => {
  if (typeof spec !== "string") return null;

  let lowest: ParsedVersion | null = null;
  for (const match of spec.matchAll(VERSION_TOKEN_PATTERN)) {
    const major = Number(match[1]);
    const minor = match[2] === undefined ? 0 : Number(match[2]);
    if (!Number.isFinite(major)) continue;
    if (lowest === null || major < lowest.major) {
      lowest = { major, minor };
    }
  }
  return lowest;
};
