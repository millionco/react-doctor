import { getDiagnosticRuleIdentity } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { anonymizeDiagnosticEvidence } from "./anonymize-diagnostic-evidence.js";
import {
  RULE_EVIDENCE_MAX_DIAGNOSTIC_COUNT,
  RULE_EVIDENCE_MAX_PER_RULE_COUNT,
} from "./constants.js";
import { createDiagnosticEvidenceReader } from "./read-diagnostic-evidence.js";

export interface RuleEvidenceRecord {
  readonly category: string;
  readonly fileContext: string;
  readonly pattern: string;
  readonly plugin: string;
  readonly rule: string;
  readonly severity: string;
  readonly tokenCount: number;
  readonly truncated: boolean;
}

export const collectRuleEvidence = (
  directory: string,
  diagnostics: ReadonlyArray<Diagnostic>,
): RuleEvidenceRecord[] => {
  const readEvidence = createDiagnosticEvidenceReader(directory);
  const evidenceRecords: RuleEvidenceRecord[] = [];
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
