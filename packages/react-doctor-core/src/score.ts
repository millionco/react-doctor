import {
  ERROR_RULE_PENALTY,
  PERFECT_SCORE,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  WARNING_RULE_PENALTY,
} from "./constants.js";
import type { Diagnostic, ScoreResult } from "./types.js";

export const getScoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};

export const countUniqueRules = (
  diagnostics: Diagnostic[],
): { errorRuleCount: number; warningRuleCount: number } => {
  const errorRules = new Set<string>();
  const warningRules = new Set<string>();

  for (const diagnostic of diagnostics) {
    const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
    if (diagnostic.severity === "error") {
      errorRules.add(ruleKey);
    } else {
      warningRules.add(ruleKey);
    }
  }

  return { errorRuleCount: errorRules.size, warningRuleCount: warningRules.size };
};

export const scoreFromRuleCounts = (errorRuleCount: number, warningRuleCount: number): number => {
  const penalty = errorRuleCount * ERROR_RULE_PENALTY + warningRuleCount * WARNING_RULE_PENALTY;
  return Math.max(0, Math.round(PERFECT_SCORE - penalty));
};

export const calculateScoreLocally = (diagnostics: Diagnostic[]): ScoreResult => {
  const { errorRuleCount, warningRuleCount } = countUniqueRules(diagnostics);
  const score = scoreFromRuleCounts(errorRuleCount, warningRuleCount);
  return { score, label: getScoreLabel(score) };
};
