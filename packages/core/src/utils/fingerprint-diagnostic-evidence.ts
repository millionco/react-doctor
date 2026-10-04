import { createHash } from "node:crypto";

export const fingerprintDiagnosticEvidence = (evidence: string): string =>
  createHash("sha256").update(evidence.replace(/\s+/g, " ").trim()).digest("hex");
