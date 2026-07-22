import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "@react-doctor/core";

export const scoreColorName = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "green";
  if (score >= SCORE_OK_THRESHOLD) return "yellow";
  return "red";
};
