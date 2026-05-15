import type { Diagnostic } from "../types/diagnostic.js";
import type { JsonReportSummary } from "../types/inspect.js";

export const summarizeDiagnostics = (
  diagnostics: Diagnostic[],
  worstScore: number | null = null,
  worstScoreLabel: string | null = null,
): JsonReportSummary => {
  let errorCount = 0;
  let warningCount = 0;
  const affectedFiles = new Set<string>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errorCount++;
    else warningCount++;
    affectedFiles.add(diagnostic.filePath);
  }

  return {
    errorCount,
    warningCount,
    affectedFileCount: affectedFiles.size,
    totalDiagnosticCount: diagnostics.length,
    score: worstScore,
    scoreLabel: worstScoreLabel,
  };
};
