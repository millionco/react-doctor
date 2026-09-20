import { z } from "zod";

import {
  CLASSIFICATION_MAX_CODE_CHARACTERS,
  CLASSIFICATION_PROBABILITY_TOLERANCE,
  CLASSIFICATION_MAX_ROUNDING_DECIMALS,
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
  defaultEnabled: z.boolean().optional(),
  applicability: z.record(z.string(), z.json()).optional(),
  settings: z.record(z.string(), z.json()).optional(),
  contractSource: z.string().optional(),
  contractHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  requiredEvidence: z.array(z.enum(["jsx-runtime", "verified-contract"])).optional(),
  contractIssue: z.string().optional(),
});

export interface RuleContract extends z.infer<typeof ruleContractSchema> {}

export const classificationCandidateSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(CLASSIFICATION_SCHEMA_VERSION)]),
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
    evaluatorSourceHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    policy: z
      .object({
        population: z.enum(["default", "exhaustive", "explicit-contract"]),
        scan: z.enum(["exhaustive", "explicit-rule-list"]),
        configContract: z.string(),
        repositoryPolicy: z.literal("unobserved"),
        adoptExistingLintConfig: z.literal(false),
        respectInlineDisables: z.literal(false),
        severity: z.literal("error"),
      })
      .optional(),
    occurrences: z
      .array(
        z.object({
          id: z.string(),
          diagnosticId: z.string().optional(),
          line: z.number().int().nonnegative(),
          column: z.number().int().nonnegative(),
          message: z.string().optional(),
          help: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    occurrenceCount: z.number().int().nonnegative().optional(),
    buildEvidence: z
      .object({
        jsxRuntime: z.enum(["automatic", "classic", "unknown"]),
        jsxImportSource: z.string().optional(),
        issue: z.string().optional(),
        files: z.array(
          z.object({
            path: z.string(),
            status: z.enum(["present", "absent", "unavailable"]),
            sha256: z.string().optional(),
            facts: z.record(z.string(), z.json()).optional(),
          }),
        ),
      })
      .optional(),
  })
  .refine(
    (candidate) =>
      !candidate.contextComplete ||
      (candidate.code.trim().length > 0 &&
        (!candidate.detected ||
          (candidate.line !== null && candidate.line <= candidate.code.split("\n").length))),
    "Complete context requires nonempty code and a valid diagnostic line",
  )
  .refine(
    (candidate) =>
      !candidate.contextComplete ||
      (!candidate.rule.contractIssue &&
        (!candidate.rule.requiredEvidence?.includes("verified-contract") ||
          Boolean(candidate.rule.contractHash)) &&
        (!candidate.rule.requiredEvidence?.includes("jsx-runtime") ||
          Boolean(candidate.buildEvidence && candidate.buildEvidence.jsxRuntime !== "unknown"))),
    "Complete context requires verified rule and build evidence",
  );

export interface ClassificationCandidate extends z.infer<typeof classificationCandidateSchema> {}

const probabilitySchema = z.number().min(0).max(1);

export const assessmentSchema = z
  .object({
    choice: z.enum(["violation", "valid", "insufficient_context"]),
    probabilities: z.strictObject({
      violation: probabilitySchema,
      valid: probabilitySchema,
      insufficient_context: probabilitySchema,
    }),
    rounding: z
      .object({
        probabilityDecimals: z
          .number()
          .int()
          .min(0)
          .max(CLASSIFICATION_MAX_ROUNDING_DECIMALS)
          .optional(),
        scoreDecimals: z.number().int().min(0).max(CLASSIFICATION_MAX_ROUNDING_DECIMALS).optional(),
      })
      .optional(),
    contextSufficient: probabilitySchema,
    inputTokens: z.number().int().nonnegative(),
    provenance: z.json().optional(),
  })
  .superRefine((assessment, context) => {
    const probabilities = Object.values(assessment.probabilities);
    const roundingError =
      assessment.rounding?.probabilityDecimals === undefined
        ? 0
        : 0.5 * 10 ** -assessment.rounding.probabilityDecimals;
    if (
      Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) >
      CLASSIFICATION_PROBABILITY_TOLERANCE + probabilities.length * roundingError
    ) {
      context.addIssue({
        code: "custom",
        message: "Probabilities must sum to one within declared rounding precision",
      });
    }
    if (
      probabilities.some(
        (probability) =>
          probability >
          assessment.probabilities[assessment.choice] + CLASSIFICATION_PROBABILITY_TOLERANCE,
      )
    ) {
      context.addIssue({ code: "custom", message: "Choice must have maximal probability" });
    }
  });

export interface ClassificationAssessment extends z.infer<typeof assessmentSchema> {}

export const classificationResultSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(CLASSIFICATION_SCHEMA_VERSION)]),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  candidate: classificationCandidateSchema,
  model: z.string(),
  promptVersion: z.string(),
  threshold: z.number().gt(0.5).max(1),
  verdict: z.enum(["candidate_fp", "candidate_fn", "likely_tp", "likely_tn", "review", "error"]),
  assessment: assessmentSchema.nullable(),
  error: z.string().optional(),
  errorEvidence: z.json().optional(),
  assessmentId: z.string().optional(),
  assessmentVersion: z.string().optional(),
  policyVersion: z.string().optional(),
});

export interface ClassificationResult extends z.infer<typeof classificationResultSchema> {}

export interface ClassificationEvaluator {
  (candidate: ClassificationCandidate): Promise<ClassificationAssessment>;
}
