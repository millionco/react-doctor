import * as fs from "node:fs";
import { DEFAULT_SCORING_PROFILE } from "../constants.js";
import type { ScoringProfile } from "../types/index.js";

// A loaded profile is trusted shape-wise (it is repo-controlled config, not
// agent input), but we validate the few fields the scorer divides by so a
// malformed override fails loudly instead of producing NaN scores.
const assertUsableProfile = (profile: ScoringProfile, source: string): void => {
  if (profile.diffSizeNormalizerLines <= 0 || profile.minNormalizerLines <= 0) {
    throw new Error(`scoring profile ${source} must use positive normalizer line counts`);
  }
  if (!profile.severityWeights || !profile.dimensionWeights) {
    throw new Error(`scoring profile ${source} is missing severity or dimension weights`);
  }
};

// Resolve the scoring profile: the built-in default, or a JSON override when a
// task pins one via `--profile <path>`.
export const loadScoringProfile = (profilePath?: string): ScoringProfile => {
  if (!profilePath) return DEFAULT_SCORING_PROFILE;
  const parsed: ScoringProfile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  assertUsableProfile(parsed, profilePath);
  return parsed;
};
