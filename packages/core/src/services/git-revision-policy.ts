const SAFE_GIT_REVISION_PATTERN = /^[A-Za-z0-9_./-]+$/;
const DIFF_RANGE_OPERATOR = "..";
const SYMMETRIC_DIFF_RANGE_OPERATOR = "...";

export const GIT_REF_NAME_RULE = "must match [A-Za-z0-9_./-] without leading '-', '..', or '@{'";

export interface GitDiffRange {
  readonly base: string;
  readonly head: string;
  readonly symmetric: boolean;
}

export const isSafeGitRevision = (candidate: string): boolean => {
  if (candidate.length === 0) return false;
  if (candidate.startsWith("-")) return false;
  if (candidate.startsWith(".") || candidate.endsWith(".")) return false;
  if (candidate.includes("..") || candidate.includes("@{")) return false;
  return SAFE_GIT_REVISION_PATTERN.test(candidate);
};

export const parseGitDiffRange = (value: string): GitDiffRange | null => {
  const symmetricIndex = value.indexOf(SYMMETRIC_DIFF_RANGE_OPERATOR);
  if (symmetricIndex !== -1) {
    return {
      base: value.slice(0, symmetricIndex),
      head: value.slice(symmetricIndex + SYMMETRIC_DIFF_RANGE_OPERATOR.length),
      symmetric: true,
    };
  }

  const rangeIndex = value.indexOf(DIFF_RANGE_OPERATOR);
  if (rangeIndex === -1) return null;
  return {
    base: value.slice(0, rangeIndex),
    head: value.slice(rangeIndex + DIFF_RANGE_OPERATOR.length),
    symmetric: false,
  };
};
