import { describe, expect, it, vi } from "vite-plus/test";

import type { CorpusEvaluationRecord, CorpusRepositoryGroup } from "../src/corpus.js";
import { runEvaluationAttempts } from "../src/run-evaluation-attempts.js";

const repositoryGroup: CorpusRepositoryGroup = {
  org: "example",
  name: "app",
  ref: "HEAD",
  rootDirectories: ["packages/app", "packages/web"],
};

const failedRecord: CorpusEvaluationRecord = {
  schemaVersion: 1,
  repository: {
    org: "example",
    name: "app",
    ref: "HEAD",
    rootDir: "packages/web",
  },
  error: "Daytona capacity exhausted",
};

describe("runEvaluationAttempts", () => {
  it("retries only failed projects at the next concurrency", async () => {
    const evaluatedGroups: CorpusRepositoryGroup[] = [];
    const beforeRetry = vi.fn(async () => undefined);
    const onRetry = vi.fn();
    const onFinalFailure = vi.fn(async () => undefined);

    await runEvaluationAttempts({
      repositoryGroups: [repositoryGroup],
      attemptConcurrencies: [500, 50],
      evaluateRepositoryGroup: async (group) => {
        evaluatedGroups.push(group);
        return evaluatedGroups.length === 1 ? [failedRecord] : [];
      },
      beforeRetry,
      onBeforeRetryFailure: vi.fn(),
      onRetry,
      onFinalFailure,
    });

    expect(evaluatedGroups).toEqual([
      repositoryGroup,
      { ...repositoryGroup, rootDirectories: ["packages/web"] },
    ]);
    expect(beforeRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith({
      attemptNumber: 2,
      totalAttempts: 2,
      concurrency: 50,
      failedProjectCount: 1,
    });
    expect(onFinalFailure).not.toHaveBeenCalled();
  });

  it("records a failure once after exhausting all attempts", async () => {
    const evaluateRepositoryGroup = vi.fn(async () => [failedRecord]);
    const onFinalFailure = vi.fn(async () => undefined);

    await runEvaluationAttempts({
      repositoryGroups: [repositoryGroup],
      attemptConcurrencies: [500, 50, 10],
      evaluateRepositoryGroup,
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry: () => undefined,
      onFinalFailure,
    });

    expect(evaluateRepositoryGroup).toHaveBeenCalledTimes(3);
    expect(onFinalFailure).toHaveBeenCalledOnce();
    expect(onFinalFailure).toHaveBeenCalledWith(failedRecord);
  });

  it("continues retrying when cleanup fails", async () => {
    const cleanupError = new Error("Daytona list failed");
    const evaluatedGroups: CorpusRepositoryGroup[] = [];
    const onBeforeRetryFailure = vi.fn();
    const onFinalFailure = vi.fn(async () => undefined);

    await runEvaluationAttempts({
      repositoryGroups: [repositoryGroup],
      attemptConcurrencies: [500, 50],
      evaluateRepositoryGroup: async (group) => {
        evaluatedGroups.push(group);
        return evaluatedGroups.length === 1 ? [failedRecord] : [];
      },
      beforeRetry: async () => {
        throw cleanupError;
      },
      onBeforeRetryFailure,
      onRetry: () => undefined,
      onFinalFailure,
    });

    expect(evaluatedGroups).toEqual([
      repositoryGroup,
      { ...repositoryGroup, rootDirectories: ["packages/web"] },
    ]);
    expect(onBeforeRetryFailure).toHaveBeenCalledOnce();
    expect(onBeforeRetryFailure).toHaveBeenCalledWith(cleanupError);
    expect(onFinalFailure).not.toHaveBeenCalled();
  });
});
