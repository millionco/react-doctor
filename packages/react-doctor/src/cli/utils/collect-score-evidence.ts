import type { Diagnostic, ScoreRuleEvidence } from "@react-doctor/core";
import { collectRuleEvidence } from "./collect-rule-evidence.js";
import { METRIC } from "./constants.js";
import { recordCount } from "./record-metric.js";

export interface CollectScoreEvidenceInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly directory: string;
}

export const collectScoreEvidence = (
  input: CollectScoreEvidenceInput,
): ReadonlyArray<ScoreRuleEvidence> => {
  try {
    const evidenceRecords = collectRuleEvidence(input.directory, input.diagnostics);
    for (const evidence of evidenceRecords) {
      recordCount(METRIC.ruleEvidenceCollected, 1, {
        rule: evidence.rule,
        plugin: evidence.plugin,
        category: evidence.category,
        severity: evidence.severity,
      });
    }
    return evidenceRecords;
  } catch {
    return [];
  }
};
