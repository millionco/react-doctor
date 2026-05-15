import { findEnclosingMultilineJsxOpenerStart } from "./find-enclosing-jsx-opener.js";
import {
  findStackedDisableCommentsAbove,
  type StackedDisableComment,
} from "./find-stacked-disable-comments.js";
import { isRuleListedInComment } from "./is-rule-listed-in-comment.js";

const DISABLE_LINE_PATTERN =
  /(?:\/\/|\/\*)\s*react-doctor-disable-line\b(?:\s+([^\r\n]*?))?\s*(?:\*\/)?\s*\}?\s*$/;

interface SuppressionEvaluation {
  isSuppressed: boolean;
  nearMissHint: string | null;
}

const formatLineGap = (gapLineCount: number): string =>
  `${gapLineCount} line${gapLineCount === 1 ? "" : "s"}`;

const hasChainSuppressor = (comments: StackedDisableComment[], ruleId: string): boolean =>
  comments.some((comment) => comment.isInChain && isRuleListedInComment(comment.ruleList, ruleId));

const findAdjacentRuleListMismatch = (
  comments: StackedDisableComment[],
  ruleId: string,
): StackedDisableComment | undefined =>
  comments.find(
    (comment) =>
      comment.isInChain &&
      Boolean(comment.ruleList?.trim()) &&
      !isRuleListedInComment(comment.ruleList, ruleId),
  );

const findOutOfChainMatch = (
  comments: StackedDisableComment[],
  ruleId: string,
): StackedDisableComment | undefined =>
  comments.find((comment) => !comment.isInChain && isRuleListedInComment(comment.ruleList, ruleId));

const buildAdjacentMismatchHint = (comment: StackedDisableComment, ruleId: string): string => {
  const ruleListText = comment.ruleList?.trim() ?? "";
  return (
    `An adjacent react-doctor-disable-next-line at line ${comment.commentLineIndex + 1} lists "${ruleListText}" — ${ruleId} is not in that list. ` +
    `Use the comma form: react-doctor-disable-next-line ${ruleListText}, ${ruleId}`
  );
};

const buildGapHint = (
  comment: StackedDisableComment,
  diagnosticLineIndex: number,
  ruleId: string,
): string => {
  const commentLineNumber = comment.commentLineIndex + 1;
  const diagnosticLineNumber = diagnosticLineIndex + 1;
  const gapLineCount = diagnosticLineNumber - commentLineNumber - 1;
  return (
    `A react-doctor-disable-next-line for ${ruleId} sits at line ${commentLineNumber}, but ${formatLineGap(gapLineCount)} of code separate it from the diagnostic on line ${diagnosticLineNumber}. ` +
    `Move the comment immediately above line ${diagnosticLineNumber}, or extract the surrounding code into a helper so the suppression is adjacent.`
  );
};

const classifyFromComments = (
  commentsByAnchor: StackedDisableComment[][],
  diagnosticLineIndex: number,
  ruleId: string,
): string | null => {
  for (const comments of commentsByAnchor) {
    const adjacentMismatch = findAdjacentRuleListMismatch(comments, ruleId);
    if (adjacentMismatch) return buildAdjacentMismatchHint(adjacentMismatch, ruleId);
    const outOfChainMatch = findOutOfChainMatch(comments, ruleId);
    if (outOfChainMatch) return buildGapHint(outOfChainMatch, diagnosticLineIndex, ruleId);
  }
  return null;
};

export const evaluateSuppression = (
  lines: string[],
  diagnosticLineIndex: number,
  ruleId: string,
): SuppressionEvaluation => {
  const sameLineMatch = lines[diagnosticLineIndex]?.match(DISABLE_LINE_PATTERN);
  if (sameLineMatch && isRuleListedInComment(sameLineMatch[1], ruleId)) {
    return { isSuppressed: true, nearMissHint: null };
  }

  const directComments = findStackedDisableCommentsAbove(lines, diagnosticLineIndex);
  if (hasChainSuppressor(directComments, ruleId)) {
    return { isSuppressed: true, nearMissHint: null };
  }

  const openerStartIndex = findEnclosingMultilineJsxOpenerStart(lines, diagnosticLineIndex);
  const openerComments =
    openerStartIndex !== null && openerStartIndex > 0
      ? findStackedDisableCommentsAbove(lines, openerStartIndex)
      : [];
  if (hasChainSuppressor(openerComments, ruleId)) {
    return { isSuppressed: true, nearMissHint: null };
  }

  const nearMissHint = classifyFromComments(
    [directComments, openerComments],
    diagnosticLineIndex,
    ruleId,
  );
  return { isSuppressed: false, nearMissHint };
};
