import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "../constants";

export const getScoreLabel = (score: number) => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};
