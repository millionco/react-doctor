import {
  TUI_FUZZY_CONSECUTIVE_BONUS,
  TUI_FUZZY_LEADING_PENALTY,
  TUI_FUZZY_WORD_BOUNDARY_BONUS,
} from "../../utils/constants.js";

export interface FuzzyMatchResult {
  readonly score: number;
  readonly matchedIndices: ReadonlyArray<number>;
}

export const fuzzyMatch = (query: string, target: string): FuzzyMatchResult | null => {
  if (query.length === 0) return { score: 0, matchedIndices: [] };

  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const matchedIndices: number[] = [];
  let score = 0;
  let queryIndex = 0;
  let previousMatchIndex = Number.NEGATIVE_INFINITY;

  for (
    let targetIndex = 0;
    targetIndex < lowerTarget.length && queryIndex < lowerQuery.length;
    targetIndex++
  ) {
    if (lowerTarget[targetIndex] !== lowerQuery[queryIndex]) continue;
    matchedIndices.push(targetIndex);
    if (targetIndex === previousMatchIndex + 1) score += TUI_FUZZY_CONSECUTIVE_BONUS;
    const previousCharacter = target[targetIndex - 1];
    const isWordBoundary =
      targetIndex === 0 ||
      previousCharacter === "-" ||
      previousCharacter === "_" ||
      previousCharacter === "/" ||
      previousCharacter === " ";
    if (isWordBoundary) score += TUI_FUZZY_WORD_BOUNDARY_BONUS;
    previousMatchIndex = targetIndex;
    queryIndex++;
  }

  if (queryIndex < lowerQuery.length) return null;
  score -= matchedIndices[0] * TUI_FUZZY_LEADING_PENALTY;
  return { score, matchedIndices };
};
