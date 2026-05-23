// HACK: extracts the lowest concrete React major from a peer-dependency
// range. Used to compute the effective React version for libraries:
// a library with `"react": "^17 || ^18 || ^19"` has an effective major
// of 17, so version-gated rules that require React 19+ are suppressed.
import {
  getBranchLowestMajor,
  getLowestDependencyMajor,
  hasUpperBoundComparator,
  normalizeDependencyVersion,
  splitDependencyVersionBranches,
} from "./utils/dependency-version-spec.js";

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
