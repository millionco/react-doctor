import { DiagnosticSeverity, type Diagnostic as LspDiagnostic } from "vscode-languageserver";

/**
 * Human-readable label for an LSP diagnostic's severity. Maps all four LSP
 * severities (not just error/warning) so demoted findings — e.g. design
 * rules shown as `Information` — aren't mislabeled in hovers and reports.
 */
export const severityLabel = (severity: LspDiagnostic["severity"]): string => {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return "error";
    case DiagnosticSeverity.Information:
      return "info";
    case DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "warning";
  }
};
