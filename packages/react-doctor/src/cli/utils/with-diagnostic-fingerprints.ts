import { DIAGNOSTIC_DELTA_IDENTITY, fingerprintDiagnosticEvidence } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { createDiagnosticEvidenceReader } from "./read-diagnostic-evidence.js";

export const withDiagnosticFingerprints = (
  directory: string,
  diagnostics: ReadonlyArray<Diagnostic>,
): Diagnostic[] => {
  const readEvidence = createDiagnosticEvidenceReader(directory);
  return diagnostics.map((diagnostic) => {
    const explicitIdentity = Reflect.get(diagnostic, DIAGNOSTIC_DELTA_IDENTITY);
    return {
      ...diagnostic,
      fingerprint:
        typeof explicitIdentity === "string"
          ? `identity:${fingerprintDiagnosticEvidence(explicitIdentity)}`
          : fingerprintDiagnosticEvidence(readEvidence(diagnostic) ?? ""),
    };
  });
};
