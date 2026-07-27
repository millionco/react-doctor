import { highlighter } from "../../core/core-presentation.js";
import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "../../core/core-score.js";

export const colorizeByScore = (text: string, score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return highlighter.success(text);
  if (score >= SCORE_OK_THRESHOLD) return highlighter.warn(text);
  return highlighter.error(text);
};
