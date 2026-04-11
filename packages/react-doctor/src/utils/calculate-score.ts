import {
  ERROR_RULE_PENALTY,
  PERFECT_SCORE,
  SCORE_API_URL,
  SCORE_GOOD_THRESHOLD,
  SCORE_OK_THRESHOLD,
  WARNING_RULE_PENALTY,
} from "../constants.js";
import type { Diagnostic, ScoreResult } from "../types.js";
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

export const calculateScoreLocally = (diagnostics: Diagnostic[]): ScoreResult => {
  const { errorRuleCount, warningRuleCount } = countUniqueRules(diagnostics);
  const score = scoreFromRuleCounts(errorRuleCount, warningRuleCount);
  return { score, label: getScoreLabel(score) };
};

export const calculateScore = async (diagnostics: Diagnostic[]): Promise<ScoreResult | null> => {
  try {
    const response = await proxyFetch(SCORE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostics }),
    });

    if (!response.ok) return calculateScoreLocally(diagnostics);

    return (await response.json()) as ScoreResult;
  } catch {
    return calculateScoreLocally(diagnostics);
  }
};
