import { getDiagnosticRuleIdentity } from "@react-doctor/core";
import type { Diagnostic, ScoreRuleEvidence } from "@react-doctor/core";
import { anonymizeDiagnosticEvidence } from "./anonymize-diagnostic-evidence.js";
import {
  RULE_EVIDENCE_MAX_DIAGNOSTIC_COUNT,
  RULE_EVIDENCE_MAX_PER_RULE_COUNT,
  RULE_EVIDENCE_SCHEMA_VERSION,
} from "./constants.js";
import { createDiagnosticEvidenceReader } from "./read-diagnostic-evidence.js";

export const collectRuleEvidence = (
  directory: string,
  diagnostics: ReadonlyArray<Diagnostic>,
): ScoreRuleEvidence[] => {
  const readEvidence = createDiagnosticEvidenceReader(directory);
  const evidenceRecords: ScoreRuleEvidence[] = [];
  const patternKeys = new Set<string>();
  const ruleCounts = new Map<string, number>();

  for (const diagnostic of diagnostics) {
    if (evidenceRecords.length >= RULE_EVIDENCE_MAX_DIAGNOSTIC_COUNT) break;
    if (diagnostic.plugin !== "react-doctor") continue;
    const { ruleKey, category } = getDiagnosticRuleIdentity(diagnostic);
    if ((ruleCounts.get(ruleKey) ?? 0) >= RULE_EVIDENCE_MAX_PER_RULE_COUNT) continue;
    const evidence = readEvidence(diagnostic);
    if (evidence === null) continue;
    const anonymizedEvidence = anonymizeDiagnosticEvidence(evidence);
    if (anonymizedEvidence.pattern === "") continue;
    const patternKey = `${ruleKey}\0${anonymizedEvidence.pattern}`;
    if (patternKeys.has(patternKey)) continue;
    patternKeys.add(patternKey);
    ruleCounts.set(ruleKey, (ruleCounts.get(ruleKey) ?? 0) + 1);
    evidenceRecords.push({
      schemaVersion: RULE_EVIDENCE_SCHEMA_VERSION,
      category,
      fileContext: diagnostic.fileContext ?? "production",
      pattern: anonymizedEvidence.pattern,
      plugin: diagnostic.plugin,
      rule: ruleKey,
      severity: diagnostic.severity,
      tokenCount: anonymizedEvidence.tokenCount,
      truncated: anonymizedEvidence.truncated,
    });
  }

  return evidenceRecords;
};
