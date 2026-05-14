import type { FailOnLevel } from "../types/config.js";
import type { Diagnostic } from "../types/diagnostic.js";

export const shouldFailForDiagnostics = (
  diagnostics: Diagnostic[],
  failOnLevel: FailOnLevel,
): boolean => {
  if (failOnLevel === "none") return false;
  if (failOnLevel === "warning") return diagnostics.length > 0;
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
};
