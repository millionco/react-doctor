import * as semver from "semver";
import type { PackageJson } from "../types/index.js";
import {
  TAILWIND_POSTCSS7_COMPAT_ALIAS,
  TAILWIND_POSTCSS7_COMPAT_MAJOR,
  TAILWIND_POSTCSS7_COMPAT_MINOR,
} from "./constants.js";

const UNRESOLVABLE_PROTOCOL_VERSION =
  /^(?:catalog|file|git|github|https?|link|patch|portal|workspace|npm):/i;
const DIST_TAG_VERSION = /^[a-z][a-z0-9._-]*$/i;
const WILDCARD_VERSION = /^[*xX](?:\.[*xX])*$/;
const NPM_ALIAS_VERSION = /^npm:(?:@[^/]+\/[^@]+|[^@]+)@(.+)$/i;

interface LowerBoundMajor {
  end: number;
  major: number;
}

const isDigit = (value: string | undefined): boolean =>
  value !== undefined && value >= "0" && value <= "9";

const isWhitespace = (value: string | undefined): boolean =>
  value === " " ||
  value === "\t" ||
  value === "\n" ||
  value === "\r" ||
  value === "\f" ||
  value === "\v";

const isSeparator = (value: string | undefined): boolean =>
  isWhitespace(value) || value === "," || value === "|";

const skipWhitespace = (value: string, start: number): number => {
  let index = start;
  while (isWhitespace(value[index])) index += 1;
  return index;
};

const skipSeparators = (value: string, start: number): number => {
  let index = start;
  while (isSeparator(value[index])) index += 1;
  return index;
};

const readDigits = (value: string, start: number): number => {
  let index = start;
  while (isDigit(value[index])) index += 1;
  return index;
};

const getUpperBoundComparatorEnd = (version: string, start: number): number | null => {
  if (version[start] !== "<") return null;

  let index = skipWhitespace(version, start + 1);
  if (version[index] === "=") index = skipWhitespace(version, index + 1);

  const majorStart = index;
  index = readDigits(version, index);
  if (index === majorStart) return null;

  for (let segments = 0; segments < 2 && version[index] === "."; segments += 1) {
    const segmentStart = index + 1;
    const segmentEnd = readDigits(version, segmentStart);
    if (segmentEnd === segmentStart) break;
    index = segmentEnd;
  }

  if (version[index] === "-") {
    index += 1;
    while (index < version.length && !isSeparator(version[index])) index += 1;
  }

  return index;
};

const stripUpperBoundComparators = (version: string): string => {
  let stripped = "";
  let index = 0;

  while (index < version.length) {
    const comparatorEnd = getUpperBoundComparatorEnd(version, index);
    if (comparatorEnd === null) {
      stripped += version[index];
      index += 1;
      continue;
    }

    stripped += " ";
    index = comparatorEnd;
  }

  return stripped;
};

const hasNonLowerBoundComparator = (branch: string): boolean => {
  for (let index = 0; index < branch.length; index += 1) {
    if (index > 0 && !isSeparator(branch[index - 1])) continue;

    if (branch[index] === ">" && branch[index + 1] !== "=") {
      const valueIndex = skipWhitespace(branch, index + 1);
      if (isDigit(branch[valueIndex])) return true;
      continue;
    }

    if (branch[index] !== "!") continue;

    let valueIndex = index + 1;
    if (branch[valueIndex] === "=") valueIndex += 1;
    if (branch[valueIndex] === "=") valueIndex += 1;
    valueIndex = skipWhitespace(branch, valueIndex);
    if (isDigit(branch[valueIndex])) return true;
  }

  return false;
};

const isMajorTerminator = (value: string | undefined): boolean =>
  value === undefined ||
  isSeparator(value) ||
  value === "." ||
  value === "*" ||
  value === "x" ||
  value === "X" ||
  value === "-";

const getLowerBoundMajorAt = (branch: string, start: number): LowerBoundMajor | null => {
  let index = start;

  if (branch[index] === ">" && branch[index + 1] === "=") {
    index = skipWhitespace(branch, index + 2);
  } else if (
    branch[index] === "~" ||
    branch[index] === "^" ||
    branch[index] === "=" ||
    branch[index] === "v"
  ) {
    index = skipWhitespace(branch, index + 1);
  }

  const majorStart = index;
  const majorEnd = readDigits(branch, majorStart);
  if (majorEnd === majorStart || !isMajorTerminator(branch[majorEnd])) return null;

  return {
    end: majorEnd,
    major: Number.parseInt(branch.slice(majorStart, majorEnd), 10),
  };
};

export const normalizeDependencyVersion = (version: string): string | null => {
  const trimmed = version.trim();
  if (trimmed.length === 0) return null;

  const npmAliasMatch = trimmed.match(NPM_ALIAS_VERSION);
  const normalizedVersion = npmAliasMatch?.[1]?.trim() ?? trimmed;
  if (UNRESOLVABLE_PROTOCOL_VERSION.test(normalizedVersion)) return null;
  if (DIST_TAG_VERSION.test(normalizedVersion) && !/^v\d/i.test(normalizedVersion)) return null;
  if (WILDCARD_VERSION.test(normalizedVersion)) return null;

  return normalizedVersion;
};

export const splitDependencyVersionBranches = (version: string): string[] =>
  version
    .split("||")
    .map((branch) => branch.trim())
    .filter(Boolean);

export const hasUpperBoundComparator = (version: string): boolean => {
  for (let index = 0; index < version.length; index += 1) {
    if (getUpperBoundComparatorEnd(version, index) !== null) return true;
  }
  return false;
};

export const getBranchLowestMajor = (branch: string): number | null => {
  if (hasNonLowerBoundComparator(branch)) return null;

  const lowerBoundComparators = stripUpperBoundComparators(branch).trim();
  if (lowerBoundComparators.length === 0) return null;

  let branchLowestMajor: number | null = null;
  let index = 0;
  while (index < lowerBoundComparators.length) {
    const lowerBoundStart = skipSeparators(lowerBoundComparators, index);
    if (lowerBoundStart > 0 && !isSeparator(lowerBoundComparators[lowerBoundStart - 1])) {
      index = lowerBoundStart + 1;
      continue;
    }

    const lowerBoundMajor = getLowerBoundMajorAt(lowerBoundComparators, lowerBoundStart);
    if (
      lowerBoundMajor !== null &&
      Number.isFinite(lowerBoundMajor.major) &&
      lowerBoundMajor.major > 0
    ) {
      const major = lowerBoundMajor.major;
      if (branchLowestMajor === null || major < branchLowestMajor) branchLowestMajor = major;
    }
    index = lowerBoundMajor?.end ?? lowerBoundStart + 1;
  }

  return branchLowestMajor;
};

export const getLowestDependencyMajor = (version: string): number | null => {
  const normalizedVersion = normalizeDependencyVersion(version);
  if (normalizedVersion === null) return null;

  let lowestMajor: number | null = null;
  for (const branch of splitDependencyVersionBranches(normalizedVersion)) {
    const normalizedBranch = normalizeDependencyVersion(branch);
    if (normalizedBranch === null) return null;

    const branchLowestMajor = getBranchLowestMajor(normalizedBranch);
    if (branchLowestMajor === null && hasUpperBoundComparator(normalizedBranch)) return null;
    if (branchLowestMajor !== null && (lowestMajor === null || branchLowestMajor < lowestMajor)) {
      lowestMajor = branchLowestMajor;
    }
  }

  return lowestMajor;
};

export const getDependencyMajorWithinSupportedRange = (
  version: string,
  latestSupportedMajor: number,
): number | null => {
  const normalizedVersion = normalizeDependencyVersion(version);
  if (normalizedVersion === null) return null;
  const validRange = semver.validRange(normalizedVersion);
  if (validRange === null) return null;
  const minimumVersion = semver.minVersion(validRange);
  if (minimumVersion === null || minimumVersion.major > latestSupportedMajor) return null;
  if (semver.intersects(validRange, `>=${latestSupportedMajor + 1}.0.0`)) return null;
  return minimumVersion.major;
};

export const isConcreteDependencyVersion = (version: string): boolean => {
  const normalizedVersion = normalizeDependencyVersion(version);
  return normalizedVersion !== null && /\d/.test(normalizedVersion);
};

export interface MajorMinor {
  major: number;
  minor: number;
}

export const isMajorMinorAtLeast = (detected: MajorMinor | null, required: MajorMinor): boolean => {
  // HACK: when detection failed (workspace protocols, dist-tags like
  // "latest", etc.) optimistically treat the project as running the latest
  // version so we surface the version-gated rule rather than silently
  // dropping it. Callers gate on a separate "detected at all" check (e.g.
  // `reactMajorVersion !== null`) before relying on this.
  if (detected === null) return true;
  if (detected.major !== required.major) return detected.major > required.major;
  return detected.minor >= required.minor;
};

// HACK: react-doctor reads the project's React version straight out of
// package.json, which produces semver ranges (`^19.0.0`, `~18.3.1`,
// `>=18 <20`, `19.x`, `latest`, etc.) — never a normalized number. The
// rule registry needs an integer major to gate React-19-only rules
// (e.g. `no-react19-deprecated-apis`, `no-default-props`) without
// false-positive flagging on React 17 / 18 codebases.
//
// We drop upper-bound comparators, then grab the first semver-like lower-bound
// integer.
// That gives the right answer for every lower-bound shape we see in
// practice:
//   "19.0.0" → 19, "^18.3.1" → 18, "~17.0.2" → 17, ">=18 <20" → 18,
//   "19.x" → 19, "<19" → null, "workspace:*" → null, "*" → null.
//
// Returning `null` for tags ("latest", "next"), workspace protocols,
// and ranges that don't carry a concrete lower bound is intentional:
// callers should treat `null` as "unknown — do not enable version-gated
// rules" so React-19-only migrations don't false-positive on React 18
// projects whose exact version could not be classified.
export const parseReactMajor = (reactVersion: string | null | undefined): number | null => {
  if (typeof reactVersion !== "string") return null;
  return getLowestDependencyMajor(reactVersion);
};

// HACK: react-doctor reads the project's Tailwind version straight out
// of package.json (the `tailwindcss` dep), which produces semver ranges
// (`^3.4.1`, `~3.3.0`, `>=3 <5`, `4.x`, `latest`, etc.) — never a
// normalized number. Some Tailwind-version-gated rules need the MINOR
// in addition to the major (e.g. the `size-N` shorthand only landed in
// Tailwind v3.4 — gating purely on `major >= 3` would mis-fire on
// v3.0 … v3.3 codebases).

const parseLowerBoundVersion = (versionSpec: string): semver.SemVer | null => {
  const validRange = semver.validRange(versionSpec);
  return validRange === null ? null : semver.minVersion(validRange);
};

const VERSION_SOURCE_REFERENCE_PATTERN = /[:/#@]/;
const MAJOR_MINOR_PATTERN = /(\d{1,4})\.(\d{1,4})/;
const MAJOR_ONLY_PATTERN = /(\d{1,4})/;
const UPPER_BOUND_COMPARATOR_PATTERN = /<=?\s{0,8}\d{1,4}(?:\.\d{1,4}){0,2}(?:-[^\s,|]+)?/g;

export const parseThreeRelease = (threeVersion: string | null | undefined): number | null => {
  if (typeof threeVersion !== "string") return null;
  const normalizedVersion = normalizeDependencyVersion(threeVersion);
  if (normalizedVersion === null) return null;

  const lowerBound = parseLowerBoundVersion(normalizedVersion);
  if (lowerBound === null) return null;
  if (lowerBound.major > 0) return Number.MAX_SAFE_INTEGER;
  return lowerBound.minor > 0 ? lowerBound.minor : null;
};

export const parseDependencyMajorMinor = (
  dependencyVersion: string | null | undefined,
): MajorMinor | null => {
  if (typeof dependencyVersion !== "string") return null;
  const normalizedVersion = normalizeDependencyVersion(dependencyVersion);
  if (normalizedVersion === null) return null;

  const lowerBound = parseLowerBoundVersion(normalizedVersion);
  if (lowerBound === null || lowerBound.major <= 0) return null;
  return { major: lowerBound.major, minor: lowerBound.minor };
};

export const parseReactMajorMinor = (
  reactVersion: string | null | undefined,
): MajorMinor | null => {
  if (typeof reactVersion !== "string") return null;
  const normalizedVersion = normalizeDependencyVersion(reactVersion);
  if (normalizedVersion === null) return null;

  const lowerBound = parseLowerBoundVersion(normalizedVersion);
  if (lowerBound !== null) {
    if (lowerBound.major <= 0) return null;
    return { major: lowerBound.major, minor: lowerBound.minor };
  }
  if (VERSION_SOURCE_REFERENCE_PATTERN.test(normalizedVersion)) return null;

  const lowerBoundsOnly = normalizedVersion.replace(UPPER_BOUND_COMPARATOR_PATTERN, " ").trim();
  const majorMinorMatch = lowerBoundsOnly.match(MAJOR_MINOR_PATTERN);
  if (majorMinorMatch) {
    const major = Number.parseInt(majorMinorMatch[1], 10);
    const minor = Number.parseInt(majorMinorMatch[2], 10);
    if (!Number.isFinite(major) || major <= 0 || !Number.isFinite(minor) || minor < 0) return null;
    return { major, minor };
  }

  const majorOnlyMatch = lowerBoundsOnly.match(MAJOR_ONLY_PATTERN);
  if (!majorOnlyMatch) return null;
  const major = Number.parseInt(majorOnlyMatch[1], 10);
  return Number.isFinite(major) && major > 0 ? { major, minor: 0 } : null;
};

export const isTailwindPostcss7CompatAlias = (tailwindVersion: string): boolean => {
  const normalizedAlias = tailwindVersion.trim().toLowerCase();
  if (normalizedAlias === TAILWIND_POSTCSS7_COMPAT_ALIAS) return true;
  if (!normalizedAlias.startsWith(`${TAILWIND_POSTCSS7_COMPAT_ALIAS}@`)) return false;
  const compatibilityAliasTarget = normalizedAlias.slice(TAILWIND_POSTCSS7_COMPAT_ALIAS.length + 1);
  return (
    DIST_TAG_VERSION.test(compatibilityAliasTarget) ||
    WILDCARD_VERSION.test(compatibilityAliasTarget)
  );
};

export const parseTailwindMajorMinor = (
  tailwindVersion: string | null | undefined,
): MajorMinor | null => {
  if (typeof tailwindVersion !== "string") return null;
  const parsedVersion = parseDependencyMajorMinor(tailwindVersion);
  if (parsedVersion !== null) return parsedVersion;

  if (isTailwindPostcss7CompatAlias(tailwindVersion)) {
    return {
      major: TAILWIND_POSTCSS7_COMPAT_MAJOR,
      minor: TAILWIND_POSTCSS7_COMPAT_MINOR,
    };
  }

  const normalizedVersion = normalizeDependencyVersion(tailwindVersion);
  if (normalizedVersion === null || !hasUpperBoundComparator(normalizedVersion)) return null;
  const lowerBound = parseLowerBoundVersion(normalizedVersion);
  return lowerBound !== null && lowerBound.major === 0 ? { major: 0, minor: 0 } : null;
};

// HACK: extracts the lowest concrete React major from a peer-dependency
// range. Used to compute the effective React version for libraries:
// a library with `"react": "^17 || ^18 || ^19"` has an effective major
// of 17, so version-gated rules that require React 19+ are suppressed.
export const hasUpperBoundOnlyPeerRange = (range: string | null | undefined): boolean => {
  if (typeof range !== "string") return false;
  const normalizedRange = normalizeDependencyVersion(range);
  if (normalizedRange === null) return false;
  return splitDependencyVersionBranches(normalizedRange).some((branch) => {
    const normalizedBranch = normalizeDependencyVersion(branch);
    return (
      normalizedBranch !== null &&
      getBranchLowestMajor(normalizedBranch) === null &&
      hasUpperBoundComparator(normalizedBranch)
    );
  });
};

export const peerRangeMinMajor = (range: string | null | undefined): number | null => {
  if (typeof range !== "string") return null;
  return getLowestDependencyMajor(range);
};

export const resolveEffectiveReactMajor = (
  reactVersion: string | null,
  packageJson: PackageJson,
): number | null => {
  const installedReactMajor = parseReactMajor(reactVersion);
  const peerReactRange = packageJson.peerDependencies?.react;
  if (typeof peerReactRange !== "string") return installedReactMajor;

  const peerFloor = peerRangeMinMajor(peerReactRange);
  if (peerFloor === null) {
    return hasUpperBoundOnlyPeerRange(peerReactRange) ? null : installedReactMajor;
  }
  return installedReactMajor !== null ? Math.min(installedReactMajor, peerFloor) : peerFloor;
};
