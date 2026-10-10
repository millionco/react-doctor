import { z } from "zod";

import {
  classificationCandidateSchema,
  classificationReviewReasonSchema,
} from "./classification-schema.js";
import type { ClassificationAssessment, ClassificationContext } from "./classification-schema.js";
import {
  CLASSIFICATION_CONCURRENCY,
  CODE_GRADING_MAX_BATCH_ITEMS,
  CODE_GRADING_MAX_CONCURRENCY,
  CODE_GRADING_MAX_ID_CHARACTERS,
  CODE_GRADING_MAX_METADATA_CHARACTERS,
  CODE_GRADING_SCHEMA_VERSION,
} from "./constants.js";

import { isBoundedGradingInput } from "./utils/is-bounded-grading-input.js";

const candidateFields = classificationCandidateSchema.shape;

const boundedItemSchema = z
  .object({
    id: z.string().min(1).max(CODE_GRADING_MAX_ID_CHARACTERS),
    code: candidateFields.code.refine((code) => code.trim().length > 0, "Code must not be empty"),
    rule: candidateFields.rule.extend({
      description: candidateFields.rule.shape.description.max(CODE_GRADING_MAX_METADATA_CHARACTERS),
    }),
    filePath: candidateFields.filePath.default("snippet.tsx"),
    framework: candidateFields.framework.default("unknown"),
    project: candidateFields.project,
    buildEvidence: candidateFields.buildEvidence,
    line: candidateFields.line.default(null),
    column: candidateFields.column,
    detected: z.boolean().nullable().default(null),
    contextComplete: z.boolean().default(true),
  })
  .refine(
    (item) => item.line === null || item.line <= item.code.split("\n").length,
    "The focus line must be in the supplied code",
  );

export const codeGradingItemSchema = z
  .unknown()
  .refine(isBoundedGradingInput, "Item must be bounded, acyclic JSON")
  .pipe(boundedItemSchema);

export const codeGradingBatchSchema = z.object({
  items: z.array(z.unknown()).min(1).max(CODE_GRADING_MAX_BATCH_ITEMS),
  mode: z.enum(["live", "offline"]).default("live"),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(CODE_GRADING_MAX_CONCURRENCY)
    .default(CLASSIFICATION_CONCURRENCY),
});

export interface CodeGradingItem extends z.infer<typeof codeGradingItemSchema> {}

export interface CodeGradingEvaluator {
  id: string;
  evaluate: (
    context: ClassificationContext,
    signal?: AbortSignal,
  ) => Promise<ClassificationAssessment>;
}

export interface CodeGradingCache {
  get: (id: string) => ClassificationAssessment | undefined;
  set: (id: string, assessment: ClassificationAssessment) => unknown;
}

export interface CodeGradingAssessmentInput {
  id: string;
  context: ClassificationContext;
  offline: boolean;
  signal?: AbortSignal;
  onModelCall: () => void;
}

export interface CodeGradingRuntime {
  evaluatorId: string;
  assess: (input: CodeGradingAssessmentInput) => Promise<{
    assessment: ClassificationAssessment | null;
    cached: boolean;
  }>;
}

export interface CodeGradingOptions {
  evaluator?: CodeGradingEvaluator;
  cache?: CodeGradingCache;
  runtime?: CodeGradingRuntime;
  signal?: AbortSignal;
}

export interface CodeGradingResult {
  index: number;
  id: string | null;
  verdict:
    | "candidate_fp"
    | "candidate_fn"
    | "likely_tp"
    | "likely_tn"
    | "violation"
    | "valid"
    | "review"
    | "unavailable"
    | "error";
  detected: boolean | null;
  assessment: ClassificationAssessment | null;
  assessmentId: string | null;
  cached: boolean;
  reviewReasons: Array<z.infer<typeof classificationReviewReasonSchema>>;
  error?: string;
}

export interface CodeGradingBatchResult {
  schemaVersion: typeof CODE_GRADING_SCHEMA_VERSION;
  evaluator: string;
  results: CodeGradingResult[];
  summary: {
    processed: number;
    modelCalls: number;
    cached: number;
    byVerdict: Partial<Record<CodeGradingResult["verdict"], number>>;
  };
}
