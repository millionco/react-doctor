import pLimit from "p-limit";

import { EVALUATION_RETRY_REPOSITORIES_PER_SANDBOX } from "./constants.js";
import type { CorpusEvaluationRecord, CorpusRepositoryGroup } from "./corpus.js";
import { groupCorpusRepositories } from "./group-corpus-repositories.js";
import { partitionRepositoryGroups } from "./utils/partition-repository-groups.js";

export interface EvaluationRetry {
  attemptNumber: number;
  totalAttempts: number;
  concurrency: number;
  failedProjectCount: number;
}

export interface RunEvaluationAttemptsInput {
  repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>;
  repositoriesPerSandbox: number;
  attemptConcurrencies: ReadonlyArray<number>;
  evaluateRepositoryBatch: (
    repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>,
    attemptIndex: number,
  ) => Promise<ReadonlyArray<CorpusEvaluationRecord>>;
  beforeRetry: () => Promise<void>;
  onBeforeRetryFailure: (error: unknown) => void;
  onRetry: (retry: EvaluationRetry) => void;
  onFinalFailure: (record: CorpusEvaluationRecord) => Promise<void>;
}

export const runEvaluationAttempts = async ({
  repositoryGroups,
  repositoriesPerSandbox,
  attemptConcurrencies,
  evaluateRepositoryBatch,
  beforeRetry,
  onBeforeRetryFailure,
  onRetry,
  onFinalFailure,
}: RunEvaluationAttemptsInput): Promise<void> => {
  let pendingRepositoryGroups = repositoryGroups;
  for (const [attemptIndex, concurrency] of attemptConcurrencies.entries()) {
    const limit = pLimit(concurrency);
    const repositoryBatchSize =
      attemptIndex === 0 ? repositoriesPerSandbox : EVALUATION_RETRY_REPOSITORIES_PER_SANDBOX;
    const repositoryBatches = partitionRepositoryGroups(
      pendingRepositoryGroups,
      repositoryBatchSize,
    );
    const failedRecords = (
      await Promise.all(
        repositoryBatches.map((repositoryBatch) =>
          limit(() => evaluateRepositoryBatch(repositoryBatch, attemptIndex)),
        ),
      )
    ).flat();
    if (failedRecords.length === 0) return;

    const nextConcurrency = attemptConcurrencies[attemptIndex + 1];
    if (nextConcurrency === undefined) {
      for (const record of failedRecords) await onFinalFailure(record);
      return;
    }

    await beforeRetry().catch(onBeforeRetryFailure);
    pendingRepositoryGroups = groupCorpusRepositories(
      failedRecords.map((record) => record.repository),
    );
    onRetry({
      attemptNumber: attemptIndex + 2,
      totalAttempts: attemptConcurrencies.length,
      concurrency: nextConcurrency,
      failedProjectCount: failedRecords.length,
    });
  }
};
