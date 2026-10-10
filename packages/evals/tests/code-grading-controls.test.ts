import { createDeferred } from "../../core/src/utils/create-deferred.js";
import { describe, expect, it, vi } from "vite-plus/test";

import type {
  ClassificationAssessment,
  ClassificationContext,
} from "../src/classification-schema.js";
import { createCodeGradingRuntime } from "../src/create-code-grading-runtime.js";
import { createCodeGradingCache } from "../src/utils/create-code-grading-cache.js";
import { createTokenBucket } from "../src/utils/create-token-bucket.js";

const assessment: ClassificationAssessment = {
  choice: "valid",
  probabilities: { valid: 1, violation: 0, insufficient_context: 0 },
  contextSufficient: 1,
  inputTokens: 1,
};
const context: ClassificationContext = {
  rule: {
    key: "react-doctor/jsx-no-duplicate-props",
    description: "No duplicate JSX props",
    exceptions: [],
  },
  code: "<div />",
  filePath: "snippet.tsx",
  framework: "unknown",
  line: null,
};

describe("grading resource controls", () => {
  it("refills request tokens and gives the time until enough budget is available", () => {
    let now = 0;
    const bucket = createTokenBucket({ capacity: 2, windowMs: 1000, now: () => now });
    expect(bucket.consume(2)).toBe(0);
    expect(bucket.consume()).toBe(500);
    now = 250;
    expect(bucket.consume()).toBe(250);
    now = 500;
    expect(bucket.consume()).toBe(0);
    expect(bucket.consume(3)).toBe(1000);
  });

  it("expires cache entries without extending TTL on reads and evicts the least recently used", () => {
    let now = 0;
    const cache = createCodeGradingCache({ maxEntries: 2, ttlMs: 100, now: () => now });
    cache.set("first", assessment);
    cache.set("second", assessment);
    cache.get("first");
    cache.set("third", assessment);
    expect(cache.get("second")).toBeUndefined();
    const read = cache.get("first");
    if (read) read.contextSufficient = 0;
    expect(cache.get("first")?.contextSufficient).toBe(1);
    now = 99;
    expect(cache.get("first")).toEqual(assessment);
    now = 100;
    expect(cache.get("first")).toBeUndefined();
    expect(cache.snapshot()).toEqual([]);
  });

  it("restores cache records with the original expiry and drops expired or future-dated records", () => {
    const cache = createCodeGradingCache({
      ttlMs: 100,
      now: () => 100,
      records: [
        { id: "expired", assessment, expiresAt: 99 },
        { id: "valid", assessment, expiresAt: 150 },
        { id: "future", assessment, expiresAt: 300 },
      ],
    });
    expect(cache.snapshot().map((entry) => entry.id)).toEqual(["valid"]);
  });

  it("shares one model call across requests and cancels it only after the last client leaves", async () => {
    let modelSignal: AbortSignal | undefined;
    const started = createDeferred<void>();
    const evaluate = vi.fn(async (_context: ClassificationContext, signal?: AbortSignal) => {
      modelSignal = signal;
      started.resolve();
      return new Promise<ClassificationAssessment>(() => {});
    });
    const runtime = createCodeGradingRuntime({ evaluator: { id: "test", evaluate } });
    const firstClient = new AbortController();
    const secondClient = new AbortController();
    const first = runtime.assess({
      id: "same",
      context,
      offline: false,
      signal: firstClient.signal,
      onModelCall: () => {},
    });
    const second = runtime.assess({
      id: "same",
      context,
      offline: false,
      signal: secondClient.signal,
      onModelCall: () => {},
    });
    const firstRejected = expect(first).rejects.toThrow("first");
    const secondRejected = expect(second).rejects.toThrow("second");
    await started.promise;
    firstClient.abort(new Error("first"));
    await firstRejected;
    expect(modelSignal?.aborted).toBe(false);
    secondClient.abort(new Error("second"));
    await secondRejected;
    expect(modelSignal?.aborted).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("enforces model concurrency across batches and never starts cancelled queued work", async () => {
    const release = createDeferred<ClassificationAssessment>();
    const started = createDeferred<void>();
    const evaluate = vi.fn(async () => {
      started.resolve();
      return release.promise;
    });
    const runtime = createCodeGradingRuntime({
      concurrency: 1,
      evaluator: { id: "test", evaluate },
    });
    const first = runtime.assess({ id: "first", context, offline: false, onModelCall: () => {} });
    await started.promise;
    const controller = new AbortController();
    const second = runtime.assess({
      id: "second",
      context,
      offline: false,
      signal: controller.signal,
      onModelCall: () => {},
    });
    const rejected = expect(second).rejects.toThrow("cancelled");
    controller.abort(new Error("cancelled"));
    await rejected;
    release.resolve(assessment);
    await first;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("times out a stalled evaluator and does not cache a late result", async () => {
    vi.useFakeTimers();
    try {
      const release = createDeferred<ClassificationAssessment>();
      const cache = createCodeGradingCache();
      const runtime = createCodeGradingRuntime({
        cache,
        timeoutMs: 20,
        evaluator: { id: "test", evaluate: () => release.promise },
      });
      const pending = runtime.assess({
        id: "late",
        context,
        offline: false,
        onModelCall: () => {},
      });
      const rejected = expect(pending).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(30);
      await rejected;
      release.resolve(assessment);
      await Promise.resolve();
      expect(cache.get("late")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
