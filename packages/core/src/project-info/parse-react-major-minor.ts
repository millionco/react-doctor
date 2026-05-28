// HACK: react-doctor reads the project's React version straight out of
// package.json (the `react` dep), which produces semver ranges
// (`^19.2.0`, `~19.0.1`, `>=19 <20`, `19.x`, `latest`, etc.) — never a
// normalized number. Some React-version-gated rules need the MINOR in
// addition to the major (e.g. `<Activity>` shipped in React 19.2 — a
// gate purely on `major >= 19` would mis-fire on 19.0 / 19.1).
//
// Mirrors `parse-tailwind-major-minor` exactly: pull the first
// `<major>.<minor>` pair from the trimmed spec, fall back to
// `{ major, minor: 0 }` when only a major is present.
interface ReactMajorMinor {
  major: number;
  minor: number;
}

// HACK: CodeQL flags unbounded `\d+` on untrusted package.json input as
// a polynomial-backtracking risk (even though the patterns here are
// not actually polynomial — there's no nested quantifier). Bound the
// digit count so the regex is provably O(1) on any input. React
// major/minor numbers won't realistically exceed 4 digits anyway.
const MAJOR_MINOR_PATTERN = /(\d{1,4})\.(\d{1,4})/;
const MAJOR_ONLY_PATTERN = /(\d{1,4})/;

// Strip upper-bound comparators (`<19.2`, `<=20.0.0`, `<19.2-beta`) from
// the spec before regex-matching the lower bound. Without this, a spec
// like `"<19.2 >=19.0"` matches `19.2` from the upper bound and reports
// the project as React 19.2+ even though the range *excludes* 19.2.
// Mirrors the same stripping that `dependency-version-spec`'s lower-
// bound major extractor does, kept inline to keep this parser
// dependency-free.
//
// HACK: CodeQL flags consecutive `\s*` groups as polynomial-backtracking
// risk on attacker-controlled input. Use a single bounded `\s{0,8}` so
// the regex is unambiguous and linear. Semver upper bounds never
// contain internal whitespace between `<` and `=`; 8 chars between
// `<=` and the digit is more than any real spec uses.
const UPPER_BOUND_COMPARATOR_PATTERN = /<=?\s{0,8}\d{1,4}(?:\.\d{1,4}){0,2}(?:-[^\s,|]+)?/g;

export const parseReactMajorMinor = (
  reactVersion: string | null | undefined,
): ReactMajorMinor | null => {
  if (typeof reactVersion !== "string") return null;
  const trimmed = reactVersion.trim();
  if (trimmed.length === 0) return null;
  const lowerBoundsOnly = trimmed.replace(UPPER_BOUND_COMPARATOR_PATTERN, " ").trim();
  if (lowerBoundsOnly.length === 0) return null;

  const majorMinorMatch = lowerBoundsOnly.match(MAJOR_MINOR_PATTERN);
  if (majorMinorMatch) {
    const major = Number.parseInt(majorMinorMatch[1], 10);
    const minor = Number.parseInt(majorMinorMatch[2], 10);
    if (!Number.isFinite(major) || major <= 0) return null;
    if (!Number.isFinite(minor) || minor < 0) return null;
    return { major, minor };
  }

  const majorOnlyMatch = lowerBoundsOnly.match(MAJOR_ONLY_PATTERN);
  if (!majorOnlyMatch) return null;
  const major = Number.parseInt(majorOnlyMatch[1], 10);
  if (!Number.isFinite(major) || major <= 0) return null;
  return { major, minor: 0 };
};

export const isReactAtLeast = (
  detected: ReactMajorMinor | null,
  required: ReactMajorMinor,
): boolean => {
  // HACK: when detection failed (workspace protocols, dist-tags like
  // "latest", etc.) optimistically treat the project as running the
  // latest React so we surface the rule rather than silently dropping
  // it. Mirrors the React-major and Tailwind fallback policy.
  if (detected === null) return true;
  if (detected.major !== required.major) return detected.major > required.major;
  return detected.minor >= required.minor;
};
