import { assessmentSchema } from "./classification-schema.js";
import type { ClassificationAssessment } from "./classification-schema.js";
import type { CodeGradingOptions, CodeGradingRuntime } from "./code-grading-schema.js";
import {
  CLASSIFICATION_CONCURRENCY,
  CLASSIFICATION_MODEL,
  CLASSIFICATION_TIMEOUT_MS,
} from "./constants.js";
import { evaluateWithJev } from "./jev-classifier.js";
import { createCodeGradingCache } from "./utils/create-code-grading-cache.js";
import { createConcurrencyLimit } from "./utils/create-concurrency-limit.js";
import { sanitizeClassificationEvidence } from "./utils/sanitize-classification-evidence.js";
import { waitWithAbort } from "./utils/wait-with-abort.js";

export interface CodeGradingRuntimeOptions extends Pick<CodeGradingOptions, "cache" | "evaluator"> {
  concurrency?: number;
  timeoutMs?: number;
}

interface PendingAssessment {
  controller: AbortController;
  promise: Promise<ClassificationAssessment>;
  waiters: number;
  settled: boolean;
}

export const createCodeGradingRuntime = ({
  evaluator = { id: CLASSIFICATION_MODEL, evaluate: evaluateWithJev },
  cache = createCodeGradingCache(),
  concurrency = CLASSIFICATION_CONCURRENCY,
  timeoutMs = CLASSIFICATION_TIMEOUT_MS,
}: CodeGradingRuntimeOptions = {}): CodeGradingRuntime => {
  if (!evaluator.id.trim()) throw new TypeError("The evaluator ID must not be empty");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError("Evaluation timeout must be positive");
  const limitConcurrency = createConcurrencyLimit(concurrency);
  const pendingAssessments = new Map<string, PendingAssessment>();
  return {
    evaluatorId: evaluator.id,
    assess: async ({ id, context, offline, signal, onModelCall }) => {
      signal?.throwIfAborted();
      const cached = assessmentSchema.safeParse(cache.get(id));
      if (cached.success) return { assessment: cached.data, cached: true };
      if (offline) return { assessment: null, cached: false };
      let pending = pendingAssessments.get(id);
      if (!pending) {
        const controller = new AbortController();
        const promise = limitConcurrency(async () => {
          controller.signal.throwIfAborted();
          const evaluationSignal = AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(timeoutMs),
          ]);
          onModelCall();
          const response = await waitWithAbort(
            Promise.resolve().then(() => evaluator.evaluate(context, evaluationSignal)),
            evaluationSignal,
          );
          evaluationSignal.throwIfAborted();
          const assessment = assessmentSchema.parse(response);
          const sanitized = {
            ...assessment,
            provenance:
              assessment.provenance === undefined
                ? undefined
                : sanitizeClassificationEvidence(assessment.provenance),
          };
          cache.set(id, sanitized);
          return sanitized;
        });
        const entry: PendingAssessment = { controller, promise, waiters: 0, settled: false };
        pending = entry;
        pendingAssessments.set(id, entry);
        const settle = () => {
          entry.settled = true;
          if (pendingAssessments.get(id) === entry) pendingAssessments.delete(id);
        };
        void promise.then(settle, settle);
      }
      pending.waiters += 1;
      try {
        return { assessment: await waitWithAbort(pending.promise, signal), cached: false };
      } finally {
        pending.waiters -= 1;
        if (pending.waiters === 0 && !pending.settled) {
          pending.controller.abort(new Error("All grading clients disconnected"));
          if (pendingAssessments.get(id) === pending) pendingAssessments.delete(id);
        }
      }
    },
  };
};
