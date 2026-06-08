// A fully-resolved `major.minor.patch` version, parsed from a *concrete*
// version string (e.g. the `version` field of an installed
// `node_modules/<pkg>/package.json`, or an exact pin in a manifest). Range
// specs (`^19.2.0`, `~19.0.1`, `>=19 <20`, `19.x`, `latest`, `catalog:`) are
// intentionally rejected by `parseConcreteSemver` so a security check never
// guesses a project's resolved version from an ambiguous range.
export interface ConcreteSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** `true` when the version carries a prerelease tag (`-canary.1`, `-rc.0`). */
  readonly isPrerelease: boolean;
}

// HACK: digit counts are bounded so the regex is provably linear on any
// untrusted package.json input (CodeQL flags unbounded `\d+` as a
// polynomial-backtracking risk). Real version numbers never approach 7
// digits. The leading `v` is tolerated because some manifests pin `v19.2.0`.
const CONCRETE_SEMVER_PATTERN =
  /^v?(\d{1,7})\.(\d{1,7})\.(\d{1,7})(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,255})?(?:\+[0-9A-Za-z][0-9A-Za-z.-]{0,255})?$/;

export const parseConcreteSemver = (version: string | null | undefined): ConcreteSemver | null => {
  if (typeof version !== "string") return null;
  const trimmed = version.trim();
  const match = CONCRETE_SEMVER_PATTERN.exec(trimmed);
  if (match === null) return null;

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;

  const hyphenIndex = trimmed.indexOf("-");
  const plusIndex = trimmed.indexOf("+");
  const isPrerelease = hyphenIndex !== -1 && (plusIndex === -1 || hyphenIndex < plusIndex);

  return { major, minor, patch, isPrerelease };
};

// Orders two concrete versions, with a prerelease sorting *below* the release
// that shares its `major.minor.patch` (`19.2.6-rc.1` < `19.2.6`). That keeps a
// canary of a vulnerable line — e.g. `15.0.0-canary` — flagged as still below
// its patched release rather than slipping past the threshold.
export const compareConcreteSemver = (left: ConcreteSemver, right: ConcreteSemver): number => {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.isPrerelease === right.isPrerelease) return 0;
  return left.isPrerelease ? -1 : 1;
};

export const formatConcreteSemver = (version: ConcreteSemver): string =>
  `${version.major}.${version.minor}.${version.patch}${version.isPrerelease ? "-prerelease" : ""}`;
