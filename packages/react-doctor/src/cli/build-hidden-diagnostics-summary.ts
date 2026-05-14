import type { Diagnostic } from "../types/diagnostic.js";

interface HiddenDiagnosticsSummaryPart {
  severity: Diagnostic["severity"];
  count: number;
  text: string;
}

// Builds the per-severity summary parts for the "X more …" line shown
// after the truncated rule list when running without `--verbose`.
// Returns parts in severity-priority order (errors before warnings),
// each annotated with the rendered text and its source severity so
// the caller can colorize without re-deriving anything.
export const buildHiddenDiagnosticsSummary = (
  hiddenDiagnostics: Diagnostic[],
): HiddenDiagnosticsSummaryPart[] => {
  const errorCount = hiddenDiagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warningCount = hiddenDiagnostics.length - errorCount;

  const parts: HiddenDiagnosticsSummaryPart[] = [];
  if (errorCount > 0) {
    parts.push({
      severity: "error",
      count: errorCount,
      text: `✗ ${errorCount} more error${errorCount === 1 ? "" : "s"}`,
    });
  }
  if (warningCount > 0) {
    parts.push({
      severity: "warning",
      count: warningCount,
      text: `⚠ ${warningCount} more warning${warningCount === 1 ? "" : "s"}`,
    });
  }
  return parts;
};
