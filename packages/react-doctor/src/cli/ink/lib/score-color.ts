import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "../../../core/core-score.js";

export const scoreColorName = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "green";
  if (score >= SCORE_OK_THRESHOLD) return "yellow";
  return "red";
};
