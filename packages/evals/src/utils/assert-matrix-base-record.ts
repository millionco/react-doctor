import type { CorpusEvaluationRecord } from "../corpus.js";

export const assertMatrixBaseRecord = ({
  record,
  expectedRuleSetHash,
  isFullRuleSet,
}: {
  record: CorpusEvaluationRecord;
  expectedRuleSetHash: string;
  isFullRuleSet: boolean;
}): void => {
  if (!isFullRuleSet || record.error !== undefined) return;
  if (record.evaluation?.ruleSetHash !== expectedRuleSetHash) {
    throw new Error("Matrix full base rule-set hash does not match its descriptor");
  }
};
