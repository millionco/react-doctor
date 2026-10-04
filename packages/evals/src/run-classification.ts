import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import {
  assessmentSchema,
  classificationCandidateSchema,
  classificationResultSchema,
} from "./classification-schema.js";
import type {
  ClassificationAssessment,
  ClassificationCandidate,
  ClassificationEvaluator,
  ClassificationResult,
} from "./classification-schema.js";
import {
  CLASSIFICATION_ASSESSMENT_VERSION,
  CLASSIFICATION_POLICY_VERSION,
  CLASSIFICATION_MODEL,
  CLASSIFICATION_PROMPT_VERSION,
  CLASSIFICATION_SCHEMA_VERSION,
  EVALUATION_ARTIFACT_FILE_MODE,
} from "./constants.js";
import { classificationQuestions, classificationState } from "./jev-classifier.js";
import {
  classificationErrorEvidence,
  ClassificationResponseError,
} from "./classification-response-error.js";
import { sanitizeClassificationEvidence } from "./utils/sanitize-classification-evidence.js";
import { createConcurrencyLimit } from "./utils/create-concurrency-limit.js";
import { toErrorMessage } from "./utils/to-error-message.js";

export interface ClassificationOptions {
  concurrency: number;
  limit: number;
  threshold: number;
  cacheDirectory: string;
  evaluate: ClassificationEvaluator;
  write: (result: ClassificationResult, cached: boolean) => Promise<void>;
}

export interface ClassificationSummary {
  processed: number;
  cached: number;
  errors: number;
  inputTokens: number;
  byRule: Record<string, Partial<Record<ClassificationResult["verdict"], number>>>;
}

export const classifyAssessment = (
  candidate: ClassificationCandidate,
  assessment: ClassificationAssessment,
  threshold: number,
): ClassificationResult["verdict"] => {
  const { choice, probabilities, contextSufficient } = assessment;
  if (
    !candidate.contextComplete ||
    choice === "insufficient_context" ||
    contextSufficient < threshold ||
    probabilities[choice] < threshold
  ) {
    return "review";
  }
  if (choice === "violation") return candidate.detected ? "likely_tp" : "candidate_fn";
  return candidate.detected ? "candidate_fp" : "likely_tn";
};

export const classificationId = (candidate: ClassificationCandidate, threshold: number): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        candidate,
        threshold,
        model: CLASSIFICATION_MODEL,
        promptVersion: CLASSIFICATION_PROMPT_VERSION,
        questions: classificationQuestions,
        assessmentVersion: CLASSIFICATION_ASSESSMENT_VERSION,
        policyVersion: CLASSIFICATION_POLICY_VERSION,
      }),
    )
    .digest("hex");

export const classificationAssessmentId = (candidate: ClassificationCandidate): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        state: classificationState(candidate),
        repository: candidate.repository,
        detectorCommit: candidate.detectorCommit,
        ruleSetHash: candidate.ruleSetHash,
        evaluatorSourceHash: candidate.evaluatorSourceHash,
        schemaVersion: candidate.schemaVersion,
        contextComplete: candidate.contextComplete,
        contextIssue: candidate.contextIssue,
        model: CLASSIFICATION_MODEL,
        promptVersion: CLASSIFICATION_PROMPT_VERSION,
        assessmentVersion: CLASSIFICATION_ASSESSMENT_VERSION,
        questions: classificationQuestions,
      }),
    )
    .digest("hex");

const readCachedResult = async (
  filePath: string,
  id: string,
): Promise<ClassificationResult | null> => {
  try {
    const result = classificationResultSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    const expected =
      result.candidate.schemaVersion === 1
        ? classificationId(result.candidate, result.threshold)
        : classificationAssessmentId(result.candidate);
    return expected === id &&
      result.id === classificationId(result.candidate, result.threshold) &&
      result.assessmentId === id &&
      result.assessmentVersion === CLASSIFICATION_ASSESSMENT_VERSION &&
      result.policyVersion === CLASSIFICATION_POLICY_VERSION &&
      result.model === CLASSIFICATION_MODEL &&
      result.promptVersion === CLASSIFICATION_PROMPT_VERSION &&
      result.verdict !== "error" &&
      (result.assessment
        ? result.verdict ===
          classifyAssessment(result.candidate, result.assessment, result.threshold)
        : result.verdict === "review" && !result.candidate.contextComplete)
      ? result
      : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
    return null;
  }
};

const assessmentCacheSchema = z.object({
  schemaVersion: z.literal(CLASSIFICATION_SCHEMA_VERSION),
  assessmentId: z.string(),
  assessmentVersion: z.literal(CLASSIFICATION_ASSESSMENT_VERSION),
  model: z.literal(CLASSIFICATION_MODEL),
  promptVersion: z.literal(CLASSIFICATION_PROMPT_VERSION),
  candidate: classificationCandidateSchema,
  assessment: assessmentSchema.nullable(),
});

const readCachedAssessment = async (
  filePath: string,
  id: string,
): Promise<Pick<ClassificationResult, "assessment"> | null> => {
  try {
    const cached = assessmentCacheSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    if (cached.assessmentId !== id || classificationAssessmentId(cached.candidate) !== id)
      return null;
    if (cached.candidate.contextComplete !== Boolean(cached.assessment)) return null;
    return { assessment: cached.assessment };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code !== "ENOENT") throw error;
    return null;
  }
};

const classifyCandidate = async (
  candidate: ClassificationCandidate,
  options: ClassificationOptions,
): Promise<{ result: ClassificationResult; cached: boolean }> => {
  const id = classificationId(candidate, options.threshold);
  const assessmentId = candidate.schemaVersion === 1 ? id : classificationAssessmentId(candidate);
  const cachePath = join(options.cacheDirectory, `${assessmentId}.json`);
  let result: ClassificationResult = {
    schemaVersion: CLASSIFICATION_SCHEMA_VERSION,
    id,
    candidate,
    model: CLASSIFICATION_MODEL,
    promptVersion: CLASSIFICATION_PROMPT_VERSION,
    threshold: options.threshold,
    verdict: "review",
    assessment: null,
    assessmentId,
    assessmentVersion: CLASSIFICATION_ASSESSMENT_VERSION,
    policyVersion: CLASSIFICATION_POLICY_VERSION,
  };
  const cachedResult =
    candidate.schemaVersion === 1
      ? await readCachedResult(cachePath, assessmentId)
      : await readCachedAssessment(cachePath, assessmentId);
  if (cachedResult)
    return {
      result: {
        ...result,
        assessment: cachedResult.assessment,
        verdict: cachedResult.assessment
          ? classifyAssessment(candidate, cachedResult.assessment, options.threshold)
          : "review",
      },
      cached: true,
    };
  if (candidate.contextComplete && candidate.code.trim()) {
    try {
      const response = await options.evaluate(candidate);
      const parsed = assessmentSchema.safeParse(response);
      if (!parsed.success)
        throw new ClassificationResponseError("Invalid evaluation assessment", response);
      const assessment = {
        ...parsed.data,
        provenance:
          parsed.data.provenance === undefined
            ? undefined
            : sanitizeClassificationEvidence(parsed.data.provenance),
      };
      result = {
        ...result,
        assessment,
        verdict: classifyAssessment(candidate, assessment, options.threshold),
      };
    } catch (error) {
      return {
        result: {
          ...result,
          verdict: "error",
          error: String(sanitizeClassificationEvidence(toErrorMessage(error))),
          errorEvidence: sanitizeClassificationEvidence(classificationErrorEvidence(error)),
        },
        cached: false,
      };
    }
  }
  const temporaryPath = `${cachePath}.${randomUUID()}.partial`;
  try {
    const cached = candidate.schemaVersion === 1 ? result : assessmentCacheSchema.parse(result);
    await writeFile(temporaryPath, JSON.stringify(cached), {
      flag: "wx",
      mode: EVALUATION_ARTIFACT_FILE_MODE,
    });
    await rename(temporaryPath, cachePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return { result, cached: false };
};

export const runClassification = async (
  candidates: AsyncIterable<unknown>,
  options: ClassificationOptions,
): Promise<ClassificationSummary> => {
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    !Number.isFinite(options.threshold) ||
    options.threshold <= 0.5 ||
    options.threshold > 1
  ) {
    throw new Error("limit must be positive; threshold must be greater than 0.5 and at most 1");
  }
  const limitConcurrency = createConcurrencyLimit(options.concurrency);
  await mkdir(options.cacheDirectory, { recursive: true });
  const summary: ClassificationSummary = {
    processed: 0,
    cached: 0,
    errors: 0,
    inputTokens: 0,
    byRule: {},
  };
  const seen = new Set<string>();
  let batch: Array<ClassificationCandidate> = [];
  const flush = async () => {
    const results = await Promise.all(
      batch.map((candidate) => limitConcurrency(() => classifyCandidate(candidate, options))),
    );
    for (const { result, cached } of results) {
      await options.write(result, cached);
      summary.processed += 1;
      summary.cached += Number(cached);
      summary.errors += Number(result.verdict === "error");
      summary.inputTokens += cached ? 0 : (result.assessment?.inputTokens ?? 0);
      const counts = (summary.byRule[result.candidate.rule.key] ??= {});
      counts[result.verdict] = (counts[result.verdict] ?? 0) + 1;
    }
    batch = [];
  };
  for await (const value of candidates) {
    const candidate = classificationCandidateSchema.parse(value);
    const id = classificationId(candidate, options.threshold);
    if (seen.has(id)) continue;
    seen.add(id);
    batch.push(candidate);
    if (batch.length >= options.concurrency) await flush();
    if (seen.size >= options.limit) break;
  }
  await flush();
  return summary;
};
