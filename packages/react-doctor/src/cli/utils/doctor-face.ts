import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "../../core/core-score.js";

export const doctorFace = (score: number): readonly [string, string] => {
  if (score >= SCORE_GOOD_THRESHOLD) return ["◠ ◠", " ▽ "];
  if (score >= SCORE_OK_THRESHOLD) return ["• •", " ─ "];
  return ["x x", " ▽ "];
};
