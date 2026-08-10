import type { Diagnostic } from "@react-doctor/core";
import { collectRuleEvidence } from "./collect-rule-evidence.js";
import { METRIC, NANOSECONDS_PER_MILLISECOND, RULE_EVIDENCE_SCHEMA_VERSION } from "./constants.js";
import { recordCount } from "./record-metric.js";
import type { RunRootSpan } from "./with-run-span.js";

export interface RecordRuleEvidenceInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly directory: string;
  readonly rootSpan: RunRootSpan;
}

export const recordRuleEvidence = (input: RecordRuleEvidenceInput): void => {
  if (input.rootSpan === undefined) return;
  try {
    for (const evidence of collectRuleEvidence(input.directory, input.diagnostics)) {
      input.rootSpan.event("rule.evidence", BigInt(Date.now()) * NANOSECONDS_PER_MILLISECOND, {
        "evidence.schemaVersion": RULE_EVIDENCE_SCHEMA_VERSION,
        "evidence.outcome": "diagnostic",
        "evidence.pattern": evidence.pattern,
        "evidence.tokenCount": evidence.tokenCount,
        "evidence.truncated": evidence.truncated,
        "evidence.fileContext": evidence.fileContext,
        rule: evidence.rule,
        plugin: evidence.plugin,
        category: evidence.category,
        severity: evidence.severity,
      });
      recordCount(METRIC.ruleEvidenceCollected, 1, {
        rule: evidence.rule,
        plugin: evidence.plugin,
        category: evidence.category,
        severity: evidence.severity,
      });
    }
  } catch {}
};
