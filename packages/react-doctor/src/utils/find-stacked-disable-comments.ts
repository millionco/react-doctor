import { SUPPRESSION_NEAR_MISS_MAX_LINES } from "../constants.js";

const DISABLE_NEXT_LINE_PATTERN =
  /(?:\/\/|\/\*)\s*react-doctor-disable-next-line\b(?:\s+([\w/\-.,\s]+?))?\s*(?:\*\/)?\s*\}?\s*$/;

export interface StackedDisableComment {
  commentLineIndex: number;
  ruleList: string | undefined;
  isInChain: boolean;
}

export const findStackedDisableCommentsAbove = (
  lines: string[],
  anchorIndex: number,
): StackedDisableComment[] => {
  const collected: StackedDisableComment[] = [];
  let isStillInChain = true;

  for (
    let candidateIndex = anchorIndex - 1;
    candidateIndex >= 0 && anchorIndex - candidateIndex <= SUPPRESSION_NEAR_MISS_MAX_LINES;
    candidateIndex--
  ) {
    const candidateLine = lines[candidateIndex];
    if (candidateLine === undefined) break;

    const match = candidateLine.match(DISABLE_NEXT_LINE_PATTERN);
    if (match) {
      collected.push({
        commentLineIndex: candidateIndex,
        ruleList: match[1],
        isInChain: isStillInChain,
      });
      continue;
    }
    isStillInChain = false;
  }

  return collected;
};
