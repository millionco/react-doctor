import { SCORE_GOOD_THRESHOLD, SCORE_OK_THRESHOLD } from "../constants";

export const getDoctorMood = (score: number): "happy" | "neutral" | "sad" => {
  if (score >= SCORE_GOOD_THRESHOLD) return "happy";
  if (score >= SCORE_OK_THRESHOLD) return "neutral";
  return "sad";
};
