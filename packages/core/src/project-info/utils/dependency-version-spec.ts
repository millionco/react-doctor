const UPPER_BOUND_COMPARATOR = /<\s*=?\s*\d+(?:\.\d+){0,2}(?:-[^\s,|]+)?/g;
const HAS_UPPER_BOUND_COMPARATOR = /<\s*=?\s*\d+(?:\.\d+){0,2}(?:-[^\s,|]+)?/;
const OR_SEPARATOR = /\s*\|\|\s*/;
const UNRESOLVABLE_PROTOCOL_VERSION =
  /^(?:file|git|github|https?|link|patch|portal|workspace|npm):/i;
const DIST_TAG_VERSION = /^[a-z][a-z0-9._-]*$/i;
const WILDCARD_VERSION = /^[*xX](?:\.[*xX])*$/;
const NON_LOWER_BOUND_COMPARATOR = /(?:^|[\s,|])(?:>(?!=)|!={0,2})\s*\d/;
const LOWER_BOUND_MAJOR = /(?:^|[\s,|])(?:>=\s*|[~^=v]\s*)?(\d+)(?=$|[\s,|.*xX-])/g;
const NPM_ALIAS_VERSION = /^npm:(?:@[^/]+\/[^@]+|[^@]+)@(.+)$/i;

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
  version.split(OR_SEPARATOR).filter(Boolean);

export const hasUpperBoundComparator = (version: string): boolean =>
  HAS_UPPER_BOUND_COMPARATOR.test(version);

export const getBranchLowestMajor = (branch: string): number | null => {
  if (NON_LOWER_BOUND_COMPARATOR.test(branch)) return null;

  const lowerBoundComparators = branch.replace(UPPER_BOUND_COMPARATOR, " ").trim();
  if (lowerBoundComparators.length === 0) return null;

  let branchLowestMajor: number | null = null;
  for (const match of lowerBoundComparators.matchAll(LOWER_BOUND_MAJOR)) {
    const major = Number.parseInt(match[1], 10);
    if (!Number.isFinite(major) || major <= 0) continue;
    if (branchLowestMajor === null || major < branchLowestMajor) branchLowestMajor = major;
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

export const isConcreteDependencyVersion = (version: string): boolean => {
  const normalizedVersion = normalizeDependencyVersion(version);
  return normalizedVersion !== null && /\d/.test(normalizedVersion);
};
