import type { Diagnostic } from "react-doctor-web";

export const isValidScoreApiDiagnostic = (value: unknown): value is Diagnostic => {
  if (typeof value !== "object" || value === null) return false;
  const diagnosticRecord = value as Record<string, unknown>;
  return (
    typeof diagnosticRecord.filePath === "string" &&
    typeof diagnosticRecord.plugin === "string" &&
    typeof diagnosticRecord.rule === "string" &&
    (diagnosticRecord.severity === "error" || diagnosticRecord.severity === "warning") &&
    typeof diagnosticRecord.message === "string" &&
    typeof diagnosticRecord.help === "string" &&
    typeof diagnosticRecord.line === "number" &&
    typeof diagnosticRecord.column === "number" &&
    typeof diagnosticRecord.category === "string"
  );
};
