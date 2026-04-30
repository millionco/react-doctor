import type { Diagnostic, JsonReportSummary } from "../types.js";

export const summarizeDiagnostics = (
  diagnostics: Diagnostic[],
  worstScore: number | null = null,
  worstScoreLabel: string | null = null,
): JsonReportSummary => {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = new Set(diagnostics.map((diagnostic) => diagnostic.filePath)).size;

  return {
    errorCount,
    warningCount,
    affectedFileCount,
    totalDiagnosticCount: diagnostics.length,
    score: worstScore,
    scoreLabel: worstScoreLabel,
  };
};
