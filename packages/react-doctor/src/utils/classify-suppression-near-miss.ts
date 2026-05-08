import { evaluateSuppression } from "./evaluate-suppression.js";

export const classifySuppressionNearMiss = (
  lines: string[],
  diagnosticLineIndex: number,
  ruleId: string,
): string | null => evaluateSuppression(lines, diagnosticLineIndex, ruleId).nearMissHint;
