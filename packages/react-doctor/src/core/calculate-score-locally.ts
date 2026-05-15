import {
  ERROR_RULE_PENALTY,
  PERFECT_SCORE,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  WARNING_RULE_PENALTY,
} from "../constants.js";
import type { Diagnostic } from "../types/diagnostic.js";
import type { ScoreResult } from "../types/score.js";

interface ScoreBreakdown {
  errorRules: string[];
  warningRules: string[];
  errorPenalty: number;
  warningPenalty: number;
  totalPenalty: number;
  score: number;
  label: string;
}

const getScoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};

const collectUniqueRuleSets = (
  diagnostics: Diagnostic[],
): { errorRules: Set<string>; warningRules: Set<string> } => {
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

  return { errorRules, warningRules };
};

const scoreFromRuleCounts = (errorRuleCount: number, warningRuleCount: number): number => {
  const penalty = errorRuleCount * ERROR_RULE_PENALTY + warningRuleCount * WARNING_RULE_PENALTY;
  return Math.max(0, Math.round(PERFECT_SCORE - penalty));
};

export const calculateScoreLocally = (diagnostics: Diagnostic[]): ScoreResult => {
  const { errorRules, warningRules } = collectUniqueRuleSets(diagnostics);
  const score = scoreFromRuleCounts(errorRules.size, warningRules.size);
  return { score, label: getScoreLabel(score) };
};

export const calculateScoreBreakdown = (diagnostics: Diagnostic[]): ScoreBreakdown => {
  const { errorRules, warningRules } = collectUniqueRuleSets(diagnostics);
  const errorPenalty = errorRules.size * ERROR_RULE_PENALTY;
  const warningPenalty = warningRules.size * WARNING_RULE_PENALTY;
  const totalPenalty = errorPenalty + warningPenalty;
  const score = Math.max(0, Math.round(PERFECT_SCORE - totalPenalty));
  return {
    errorRules: [...errorRules].sort(),
    warningRules: [...warningRules].sort(),
    errorPenalty,
    warningPenalty,
    totalPenalty,
    score,
    label: getScoreLabel(score),
  };
};
