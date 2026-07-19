import pLimit from "p-limit";

import type { CorpusEvaluationRecord, CorpusRepositoryGroup } from "./corpus.js";
import { groupCorpusRepositories } from "./group-corpus-repositories.js";

export interface EvaluationRetry {
  attemptNumber: number;
  totalAttempts: number;
  concurrency: number;
  failedProjectCount: number;
}

export interface RunEvaluationAttemptsInput {
  repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>;
  attemptConcurrencies: ReadonlyArray<number>;
  evaluateRepositoryGroup: (
    repositoryGroup: CorpusRepositoryGroup,
  ) => Promise<ReadonlyArray<CorpusEvaluationRecord>>;
  beforeRetry: () => Promise<void>;
  onBeforeRetryFailure: (error: unknown) => void;
  onRetry: (retry: EvaluationRetry) => void;
  onFinalFailure: (record: CorpusEvaluationRecord) => Promise<void>;
}

export const runEvaluationAttempts = async ({
  repositoryGroups,
  attemptConcurrencies,
  evaluateRepositoryGroup,
  beforeRetry,
  onBeforeRetryFailure,
  onRetry,
  onFinalFailure,
}: RunEvaluationAttemptsInput): Promise<void> => {
  let pendingRepositoryGroups = repositoryGroups;
  for (const [attemptIndex, concurrency] of attemptConcurrencies.entries()) {
    const limit = pLimit(concurrency);
    const failedRecords = (
      await Promise.all(
        pendingRepositoryGroups.map((repositoryGroup) =>
          limit(() => evaluateRepositoryGroup(repositoryGroup)),
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
