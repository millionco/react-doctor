import { evaluateSuppression } from "./evaluate-suppression.js";

export const isRuleSuppressedAt = (
  lines: string[],
  diagnosticLineIndex: number,
  ruleId: string,
): boolean => evaluateSuppression(lines, diagnosticLineIndex, ruleId).isSuppressed;
