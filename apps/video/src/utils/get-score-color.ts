import {
  GREEN_COLOR,
  RED_COLOR,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  YELLOW_COLOR,
} from "../constants";

export const getScoreColor = (score: number) => {
  if (score >= SCORE_GOOD_THRESHOLD) return GREEN_COLOR;
  if (score >= SCORE_OK_THRESHOLD) return YELLOW_COLOR;
  return RED_COLOR;
};
