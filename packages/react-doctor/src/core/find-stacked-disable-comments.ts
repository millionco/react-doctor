import { SUPPRESSION_NEAR_MISS_MAX_LINES } from "../constants.js";

// HACK: the rule-list capture is intentionally permissive ([^\r\n]*?) so
// it matches any content following `disable-next-line`. The narrower
// `[\w/\-.,\s]` class previously excluded common comment punctuation
// (`;`, `:`, `(`, `'`, …) which silently prevented the regex from
// matching at all whenever someone added an explanatory `-- ...` tail
// (#159). The captured string is later split at ` -- ` and tokenized
// in isRuleListedInComment, so only the rule-id tokens before the
// description are tested against the diagnostic's rule.
const DISABLE_NEXT_LINE_PATTERN =
  /(?:\/\/|\/\*)\s*react-doctor-disable-next-line\b(?:\s+([^\r\n]*?))?\s*(?:\*\/)?\s*\}?\s*$/;

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
