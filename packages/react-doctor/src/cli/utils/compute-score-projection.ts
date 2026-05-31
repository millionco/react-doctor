import { calculateScore, TOP_ERRORS_DISPLAY_COUNT } from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { buildRulePriorityMap } from "./diagnostic-grouping.js";
import { getTopErrorRuleKeys } from "./render-diagnostics.js";

// The score reachable by fixing the top-N errors shown to the user,
// drawn as the "ghost" gain segment on the score bar. Computed by
// re-fetching the score with those rules removed — the real model's
// number, never a local estimate, and never recorded (no metadata).
// Returns null when there's nothing to project (no errors, offline, or
// the fix wouldn't move the score).
//
// `topErrorSource` selects which rules count as "the top errors" (the set
// shown to the user); `rescoreSource` is the diagnostic set actually
// re-scored after removing them. They're identical for a single project;
// for a monorepo the displayed score is the worst project's, so the top
// errors are picked across all projects but the re-score runs on the
// worst project's diagnostics (the ones whose removal moves that score).
export const computeProjectedScore = async (
  topErrorSource: Diagnostic[],
  rescoreSource: Diagnostic[],
  currentScore: ScoreResult,
): Promise<number | null> => {
  // Use the same score-API priority the renderer uses so the projected
  // "top N" rules match the ones actually displayed.
  const topErrorRuleKeys = getTopErrorRuleKeys(
    topErrorSource,
    TOP_ERRORS_DISPLAY_COUNT,
    buildRulePriorityMap([currentScore]),
  );
  if (topErrorRuleKeys.size === 0) return null;

  const remainingDiagnostics = rescoreSource.filter(
    (diagnostic) => !topErrorRuleKeys.has(`${diagnostic.plugin}/${diagnostic.rule}`),
  );
  const potentialScore = await calculateScore(remainingDiagnostics);
  if (!potentialScore || potentialScore.score <= currentScore.score) return null;

  return potentialScore.score;
};
