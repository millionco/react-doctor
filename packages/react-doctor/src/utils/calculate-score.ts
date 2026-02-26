import {
  ERROR_ESTIMATED_FIX_RATE,
  ERROR_RULE_PENALTY,
  ESTIMATE_SCORE_API_URL,
  PERFECT_SCORE,
  SCORE_API_URL,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  WARNING_ESTIMATED_FIX_RATE,
  WARNING_RULE_PENALTY,
} from "../constants.js";
import type { Diagnostic, EstimatedScoreResult, ScoreResult } from "../types.js";
import { proxyFetch } from "./proxy-fetch.js";

const getScoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};

const countUniqueRules = (
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

const scoreFromRuleCounts = (errorRuleCount: number, warningRuleCount: number): number => {
  const penalty = errorRuleCount * ERROR_RULE_PENALTY + warningRuleCount * WARNING_RULE_PENALTY;
  return Math.max(0, Math.round(PERFECT_SCORE - penalty));
};

const estimateScoreLocally = (diagnostics: Diagnostic[]): EstimatedScoreResult => {
  const { errorRuleCount, warningRuleCount } = countUniqueRules(diagnostics);

  const currentScore = scoreFromRuleCounts(errorRuleCount, warningRuleCount);
  const estimatedUnfixedErrorRuleCount = Math.round(
    errorRuleCount * (1 - ERROR_ESTIMATED_FIX_RATE),
  );
  const estimatedUnfixedWarningRuleCount = Math.round(
    warningRuleCount * (1 - WARNING_ESTIMATED_FIX_RATE),
  );
  const estimatedScore = scoreFromRuleCounts(
    estimatedUnfixedErrorRuleCount,
    estimatedUnfixedWarningRuleCount,
  );

  return {
    currentScore,
    currentLabel: getScoreLabel(currentScore),
    estimatedScore,
    estimatedLabel: getScoreLabel(estimatedScore),
  };
};

export const calculateScore = async (diagnostics: Diagnostic[]): Promise<ScoreResult | null> => {
  try {
    const response = await proxyFetch(SCORE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostics }),
    });

    if (!response.ok) return null;

    return (await response.json()) as ScoreResult;
  } catch {
    return null;
  }
};

export const fetchEstimatedScore = async (
  diagnostics: Diagnostic[],
): Promise<EstimatedScoreResult | null> => {
  try {
    const response = await proxyFetch(ESTIMATE_SCORE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostics }),
    });

    if (!response.ok) return estimateScoreLocally(diagnostics);

    return (await response.json()) as EstimatedScoreResult;
  } catch {
    return estimateScoreLocally(diagnostics);
  }
};
