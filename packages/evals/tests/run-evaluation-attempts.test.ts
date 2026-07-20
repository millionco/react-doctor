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
  it("reuses one sandbox evaluation for each balanced repository batch", async () => {
    const secondRepositoryGroup: CorpusRepositoryGroup = {
      ...repositoryGroup,
      name: "second-app",
    };
    const evaluatedBatches: ReadonlyArray<CorpusRepositoryGroup>[] = [];

    await runEvaluationAttempts({
      repositoryGroups: [repositoryGroup, secondRepositoryGroup],
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [500],
      evaluateRepositoryBatch: async (batch) => {
        evaluatedBatches.push(batch);
        return [];
      },
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry: vi.fn(),
      onFinalFailure: vi.fn(async () => undefined),
    });

    expect(evaluatedBatches).toEqual([[repositoryGroup, secondRepositoryGroup]]);
  });

  it("retries only failed projects at the next concurrency", async () => {
    const evaluatedGroups: CorpusRepositoryGroup[] = [];
    const beforeRetry = vi.fn(async () => undefined);
    const onRetry = vi.fn();
    const onFinalFailure = vi.fn(async () => undefined);

    await runEvaluationAttempts({
      repositoryGroups: [repositoryGroup],
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [500, 50],
      evaluateRepositoryBatch: async ([group]) => {
        if (!group) return [];
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

  it("isolates failed repositories into separate retry sandboxes", async () => {
    const secondRepositoryGroup: CorpusRepositoryGroup = {
      ...repositoryGroup,
      name: "second-app",
    };
    const secondFailedRecord: CorpusEvaluationRecord = {
      ...failedRecord,
      repository: {
        ...failedRecord.repository,
        name: "second-app",
      },
    };
    const evaluatedBatches: ReadonlyArray<CorpusRepositoryGroup>[] = [];

    await runEvaluationAttempts({
      repositoryGroups: [repositoryGroup, secondRepositoryGroup],
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [500, 50],
      evaluateRepositoryBatch: async (batch) => {
        evaluatedBatches.push(batch);
        return evaluatedBatches.length === 1 ? [failedRecord, secondFailedRecord] : [];
      },
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry: vi.fn(),
      onFinalFailure: vi.fn(async () => undefined),
    });

    expect(evaluatedBatches).toEqual([
      [repositoryGroup, secondRepositoryGroup],
      [{ ...repositoryGroup, rootDirectories: ["packages/web"] }],
      [{ ...secondRepositoryGroup, rootDirectories: ["packages/web"] }],
    ]);
  });

  it("records a failure once after exhausting all attempts", async () => {
    const evaluateRepositoryBatch = vi.fn(async () => [failedRecord]);
    const onFinalFailure = vi.fn(async () => undefined);

    await runEvaluationAttempts({
      repositoryGroups: [repositoryGroup],
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [500, 50, 10],
      evaluateRepositoryBatch,
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry: () => undefined,
      onFinalFailure,
    });

    expect(evaluateRepositoryBatch).toHaveBeenCalledTimes(3);
    expect(onFinalFailure).toHaveBeenCalledOnce();
    expect(onFinalFailure).toHaveBeenCalledWith(failedRecord);
  });

  it("reports the current attempt index to each batch evaluation", async () => {
    const attemptIndexes: number[] = [];

    await runEvaluationAttempts({
      repositoryGroups: [repositoryGroup],
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [500, 50, 10],
      evaluateRepositoryBatch: async (_batch, attemptIndex) => {
        attemptIndexes.push(attemptIndex);
        return attemptIndex < 2 ? [failedRecord] : [];
      },
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry: vi.fn(),
      onFinalFailure: vi.fn(async () => undefined),
    });

    expect(attemptIndexes).toEqual([0, 1, 2]);
  });

  it("continues retrying when cleanup fails", async () => {
    const cleanupError = new Error("Daytona list failed");
    const evaluatedGroups: CorpusRepositoryGroup[] = [];
    const onBeforeRetryFailure = vi.fn();
    const onFinalFailure = vi.fn(async () => undefined);

    await runEvaluationAttempts({
      repositoryGroups: [repositoryGroup],
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [500, 50],
      evaluateRepositoryBatch: async ([group]) => {
        if (!group) return [];
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
