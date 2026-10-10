import { createHash } from "node:crypto";

import type { ClassificationContext } from "./classification-schema.js";
import { codeGradingBatchSchema, codeGradingItemSchema } from "./code-grading-schema.js";
import type {
  CodeGradingBatchResult,
  CodeGradingOptions,
  CodeGradingResult,
  CodeGradingRuntime,
} from "./code-grading-schema.js";
import {
  CLASSIFICATION_ASSESSMENT_VERSION,
  CLASSIFICATION_PROMPT_VERSION,
  CLASSIFICATION_THRESHOLD,
  CODE_GRADING_SCHEMA_VERSION,
} from "./constants.js";
import { classificationQuestions, classificationState } from "./jev-classifier.js";
import { createCodeGradingRuntime } from "./create-code-grading-runtime.js";
import { classifyAssessment } from "./run-classification.js";
import { createConcurrencyLimit } from "./utils/create-concurrency-limit.js";
import { getClassificationReviewReasons } from "./utils/get-classification-review-reasons.js";
import { sanitizeClassificationEvidence } from "./utils/sanitize-classification-evidence.js";
import { toErrorMessage } from "./utils/to-error-message.js";

export const gradeCodeBatch = async (
  input: unknown,
  options: CodeGradingOptions = {},
): Promise<CodeGradingBatchResult> => {
  const batch = codeGradingBatchSchema.parse(input);
  const runtime = options.runtime ?? createCodeGradingRuntime(options);
  const limitConcurrency = createConcurrencyLimit(batch.concurrency);
  const batchAssessments = new Map<string, ReturnType<CodeGradingRuntime["assess"]>>();
  let modelCalls = 0;
  const results = await Promise.all(
    batch.items.map((value, index) =>
      limitConcurrency(async (): Promise<CodeGradingResult> => {
        const result: CodeGradingResult = {
          index,
          id: null,
          verdict: "error",
          detected: null,
          assessment: null,
          assessmentId: null,
          cached: false,
          reviewReasons: [],
        };
        if (options.signal?.aborted) return { ...result, error: "Grading request cancelled" };
        const parsed = codeGradingItemSchema.safeParse(value);
        if (!parsed.success)
          return {
            ...result,
            error:
              "Invalid item: " +
              parsed.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; "),
          };
        const item = parsed.data;
        result.id = item.id;
        result.detected = item.detected;
        const contextComplete =
          item.contextComplete &&
          !item.rule.contractIssue &&
          (!item.rule.requiredEvidence?.includes("verified-contract") ||
            Boolean(item.rule.contractHash)) &&
          (!item.rule.requiredEvidence?.includes("jsx-runtime") ||
            Boolean(item.buildEvidence && item.buildEvidence.jsxRuntime !== "unknown"));
        if (!contextComplete)
          return { ...result, verdict: "review", reviewReasons: ["incomplete_context"] };
        const context: ClassificationContext = {
          rule: item.rule,
          code: item.code,
          filePath: item.filePath,
          framework: item.framework,
          project: item.project,
          buildEvidence: item.buildEvidence,
          line: item.line,
          column: item.column,
          sourceKind: "synthetic",
        };
        const assessmentId = createHash("sha256")
          .update(
            JSON.stringify({
              state: classificationState(context),
              evaluator: runtime.evaluatorId,
              promptVersion: CLASSIFICATION_PROMPT_VERSION,
              assessmentVersion: CLASSIFICATION_ASSESSMENT_VERSION,
              questions: classificationQuestions,
            }),
          )
          .digest("hex");
        result.assessmentId = assessmentId;
        try {
          let pending = batchAssessments.get(assessmentId);
          if (!pending) {
            pending = runtime.assess({
              id: assessmentId,
              context,
              offline: batch.mode === "offline",
              signal: options.signal,
              onModelCall: () => {
                modelCalls += 1;
              },
            });
            batchAssessments.set(assessmentId, pending);
          }
          const { assessment, cached } = await pending;
          result.cached = cached;
          if (!assessment) return { ...result, verdict: "unavailable" };
          result.assessment = assessment;
          result.reviewReasons = getClassificationReviewReasons({
            candidate: { contextComplete },
            assessment,
            threshold: CLASSIFICATION_THRESHOLD,
          });
          if (result.reviewReasons.length > 0) return { ...result, verdict: "review" };
          if (item.detected === null)
            return {
              ...result,
              verdict: assessment.choice === "violation" ? "violation" : "valid",
            };
          return {
            ...result,
            verdict: classifyAssessment(
              { contextComplete, detected: item.detected },
              assessment,
              CLASSIFICATION_THRESHOLD,
            ),
          };
        } catch (error) {
          return {
            ...result,
            error: String(sanitizeClassificationEvidence(toErrorMessage(error))),
          };
        }
      }),
    ),
  );
  const byVerdict: CodeGradingBatchResult["summary"]["byVerdict"] = {};
  for (const result of results) byVerdict[result.verdict] = (byVerdict[result.verdict] ?? 0) + 1;
  return {
    schemaVersion: CODE_GRADING_SCHEMA_VERSION,
    evaluator: runtime.evaluatorId,
    results,
    summary: {
      processed: results.length,
      modelCalls,
      cached: results.filter((result) => result.cached).length,
      byVerdict,
    },
  };
};
