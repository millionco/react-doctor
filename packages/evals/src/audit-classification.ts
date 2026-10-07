import { z } from "zod";

import { classificationResultSchema } from "./classification-schema.js";
import type { ClassificationAssessment } from "./classification-schema.js";
import {
  classificationAssessmentId,
  classificationId,
  classifyAssessment,
} from "./run-classification.js";

export const classificationLabelSchema = z.object({
  assessmentId: z.string().regex(/^[0-9a-f]{64}$/),
  expected: z.enum(["violation", "valid", "insufficient_context"]),
  rationale: z.string().trim().min(1),
});

export interface ClassificationAuditRow {
  assessmentId: string;
  expected: ClassificationAssessment["choice"];
  actual: ClassificationAssessment["choice"] | null;
  accepted: boolean;
  correct: boolean;
  verdict: string;
}

export interface ClassificationAudit {
  labeled: number;
  assessed: number;
  accepted: number;
  review: number;
  errors: number;
  rawCorrect: number;
  acceptedCorrect: number;
  acceptedIncorrect: number;
  decisionCoverage: number;
  acceptedAccuracy: number | null;
  rows: ClassificationAuditRow[];
}

export const auditClassification = async (
  results: AsyncIterable<unknown>,
  labels: ReadonlyArray<unknown>,
): Promise<ClassificationAudit> => {
  const expected = new Map<string, z.infer<typeof classificationLabelSchema>>();
  for (const value of labels) {
    const label = classificationLabelSchema.parse(value);
    if (expected.has(label.assessmentId)) throw new Error("Duplicate calibration label");
    expected.set(label.assessmentId, label);
  }
  if (expected.size === 0) throw new Error("Calibration labels must not be empty");
  const seen = new Set<string>();
  const rows: ClassificationAuditRow[] = [];
  let configuration: string | undefined;
  for await (const value of results) {
    const result = classificationResultSchema.parse(value);
    const identity =
      result.candidate.schemaVersion === 1
        ? classificationId(result.candidate, result.threshold)
        : classificationAssessmentId(result.candidate);
    if (
      result.assessmentId !== identity ||
      result.id !== classificationId(result.candidate, result.threshold)
    )
      throw new Error("Calibration result identity does not match its candidate");
    const current = JSON.stringify([
      result.model,
      result.promptVersion,
      result.assessmentVersion,
      result.policyVersion,
      result.threshold,
    ]);
    if (configuration !== undefined && configuration !== current)
      throw new Error("Calibration results use different configurations");
    configuration = current;
    const label = expected.get(identity);
    if (!label) throw new Error("Calibration result has no independent label");
    if (seen.has(identity)) throw new Error("Duplicate calibration result");
    seen.add(identity);
    if (
      result.verdict !== "error" &&
      result.verdict !==
        (result.assessment
          ? classifyAssessment(result.candidate, result.assessment, result.threshold)
          : "review")
    )
      throw new Error("Calibration verdict does not match the confidence policy");
    const accepted = result.verdict !== "review" && result.verdict !== "error";
    rows.push({
      assessmentId: identity,
      expected: label.expected,
      actual: result.assessment?.choice ?? null,
      accepted,
      correct: result.assessment?.choice === label.expected,
      verdict: result.verdict,
    });
  }
  if (seen.size !== expected.size) throw new Error("Calibration results do not cover every label");
  const accepted = rows.filter((row) => row.accepted);
  const acceptedCorrect = accepted.filter((row) => row.correct).length;
  return {
    labeled: expected.size,
    assessed: rows.filter((row) => row.actual !== null).length,
    accepted: accepted.length,
    review: rows.filter((row) => row.verdict === "review").length,
    errors: rows.filter((row) => row.verdict === "error").length,
    rawCorrect: rows.filter((row) => row.correct).length,
    acceptedCorrect,
    acceptedIncorrect: accepted.length - acceptedCorrect,
    decisionCoverage: accepted.length / expected.size,
    acceptedAccuracy: accepted.length === 0 ? null : acceptedCorrect / accepted.length,
    rows,
  };
};
