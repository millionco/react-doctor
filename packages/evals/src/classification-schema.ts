import { z } from "zod";

import {
  CLASSIFICATION_MAX_CODE_CHARACTERS,
  CLASSIFICATION_PROBABILITY_TOLERANCE,
  CLASSIFICATION_SCHEMA_VERSION,
  EVALUATION_RULE_KEY_PATTERN,
  PINNED_REPOSITORY_REF_PATTERN,
} from "./constants.js";
import { parseCorpusRepository } from "./utils/parse-corpus-repository.js";

export const ruleContractSchema = z.object({
  key: z.string().regex(EVALUATION_RULE_KEY_PATTERN),
  description: z.string().trim().min(1),
  exceptions: z.array(z.string().trim().min(1)),
  sampleSilentFiles: z.boolean().optional(),
});

export interface RuleContract extends z.infer<typeof ruleContractSchema> {}

export const classificationCandidateSchema = z
  .object({
    schemaVersion: z.literal(CLASSIFICATION_SCHEMA_VERSION),
    repository: z
      .object({
        org: z.string(),
        name: z.string(),
        ref: z.string().regex(PINNED_REPOSITORY_REF_PATTERN),
        rootDir: z.string(),
      })
      .refine((repository) => parseCorpusRepository(repository) !== null, "Invalid repository"),
    detectorCommit: z.string().regex(PINNED_REPOSITORY_REF_PATTERN),
    ruleSetHash: z.string().regex(/^[0-9a-f]{64}$/),
    rule: ruleContractSchema,
    filePath: z.string().min(1),
    line: z.number().int().positive().nullable(),
    column: z.number().int().positive().nullable().optional(),
    detected: z.boolean(),
    framework: z.string(),
    project: z.record(z.string(), z.json()).optional(),
    code: z.string().max(CLASSIFICATION_MAX_CODE_CHARACTERS),
    contextComplete: z.boolean(),
    contextIssue: z.string().optional(),
  })
  .refine(
    (candidate) =>
      !candidate.contextComplete ||
      (candidate.code.trim().length > 0 &&
        (!candidate.detected ||
          (candidate.line !== null && candidate.line <= candidate.code.split("\n").length))),
    "Complete context requires nonempty code and a valid diagnostic line",
  );

export interface ClassificationCandidate extends z.infer<typeof classificationCandidateSchema> {}

const probabilitySchema = z.number().min(0).max(1);

export const assessmentSchema = z.object({
  choice: z.enum(["violation", "valid", "insufficient_context"]),
  probabilities: z
    .object({
      violation: probabilitySchema,
      valid: probabilitySchema,
      insufficient_context: probabilitySchema,
    })
    .refine(
      (probabilities) =>
        Math.abs(Object.values(probabilities).reduce((sum, value) => sum + value, 0) - 1) <=
        CLASSIFICATION_PROBABILITY_TOLERANCE,
      "Probabilities must sum to one",
    ),
  contextSufficient: probabilitySchema,
  inputTokens: z.number().int().nonnegative(),
});

export interface ClassificationAssessment extends z.infer<typeof assessmentSchema> {}

export const classificationResultSchema = z.object({
  schemaVersion: z.literal(CLASSIFICATION_SCHEMA_VERSION),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  candidate: classificationCandidateSchema,
  model: z.string(),
  promptVersion: z.string(),
  threshold: z.number().gt(0.5).max(1),
  verdict: z.enum(["candidate_fp", "candidate_fn", "likely_tp", "likely_tn", "review", "error"]),
  assessment: assessmentSchema.nullable(),
  error: z.string().optional(),
});

export interface ClassificationResult extends z.infer<typeof classificationResultSchema> {}

export interface ClassificationEvaluator {
  (candidate: ClassificationCandidate): Promise<ClassificationAssessment>;
}
