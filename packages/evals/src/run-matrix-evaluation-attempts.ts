import pLimit from "p-limit";

import type { CorpusRepositoryGroup } from "./corpus.js";
import type { MatrixEvaluationLane } from "./build-matrix-evaluation-plan.js";
import type { MatrixEvaluationFailure } from "./evaluate-matrix-repository-batch.js";
import { groupCorpusRepositories } from "./group-corpus-repositories.js";
import { partitionRepositoryGroups } from "./utils/partition-repository-groups.js";
import { toErrorMessage } from "./utils/to-error-message.js";

export interface RunMatrixEvaluationAttemptsInput {
  repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>;
  lanes: ReadonlyArray<MatrixEvaluationLane>;
  repositoriesPerSandbox: number;
  attemptConcurrencies: ReadonlyArray<number>;
  evaluateRepositoryBatch: (
    repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>,
    lanes: ReadonlyArray<MatrixEvaluationLane>,
    attemptIndex: number,
  ) => Promise<ReadonlyArray<MatrixEvaluationFailure>>;
  beforeRetry: () => Promise<void>;
  onBeforeRetryFailure: (error: unknown) => void;
  onRetry: (retry: {
    attemptNumber: number;
    totalAttempts: number;
    concurrency: number;
    failedLaneProjectCount: number;
  }) => void;
  onFinalFailure: (failure: MatrixEvaluationFailure) => Promise<void>;
}

interface MatrixEvaluationWork {
  repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>;
  lanes: ReadonlyArray<MatrixEvaluationLane>;
}

const buildRejectedWorkFailures = (
  work: MatrixEvaluationWork,
  error: unknown,
): ReadonlyArray<MatrixEvaluationFailure> =>
  work.lanes.flatMap((lane) =>
    work.repositoryGroups.flatMap((repositoryGroup) =>
      repositoryGroup.rootDirectories.map((rootDir) => ({
        laneId: lane.id,
        record: {
          schemaVersion: 1,
          repository: {
            org: repositoryGroup.org,
            name: repositoryGroup.name,
            ref: repositoryGroup.ref,
            rootDir,
          },
          error: toErrorMessage(error),
        },
      })),
    ),
  );

const buildRetryWork = (
  failures: ReadonlyArray<MatrixEvaluationFailure>,
  lanesById: ReadonlyMap<string, MatrixEvaluationLane>,
): ReadonlyArray<MatrixEvaluationWork> =>
  failures.map((failure) => {
    const lane = lanesById.get(failure.laneId);
    if (!lane) throw new Error(`Unknown failed matrix lane: ${failure.laneId}`);
    return {
      repositoryGroups: groupCorpusRepositories([failure.record.repository]),
      lanes: [lane],
    };
  });

export const runMatrixEvaluationAttempts = async ({
  repositoryGroups,
  lanes,
  repositoriesPerSandbox,
  attemptConcurrencies,
  evaluateRepositoryBatch,
  beforeRetry,
  onBeforeRetryFailure,
  onRetry,
  onFinalFailure,
}: RunMatrixEvaluationAttemptsInput): Promise<void> => {
  const lanesById = new Map(lanes.map((lane) => [lane.id, lane]));
  let pendingWork: ReadonlyArray<MatrixEvaluationWork> = partitionRepositoryGroups(
    repositoryGroups,
    repositoriesPerSandbox,
  ).map((repositoryBatch) => ({ repositoryGroups: repositoryBatch, lanes }));

  for (const [attemptIndex, concurrency] of attemptConcurrencies.entries()) {
    const limit = pLimit(concurrency);
    const workResults = await Promise.allSettled(
      pendingWork.map((work) =>
        limit(() => evaluateRepositoryBatch(work.repositoryGroups, work.lanes, attemptIndex)),
      ),
    );
    const failures = workResults.flatMap((result, workIndex) =>
      result.status === "fulfilled"
        ? result.value
        : buildRejectedWorkFailures(pendingWork[workIndex], result.reason),
    );
    if (failures.length === 0) return;

    const nextConcurrency = attemptConcurrencies[attemptIndex + 1];
    if (nextConcurrency === undefined) {
      for (const failure of failures) await onFinalFailure(failure);
      return;
    }

    await beforeRetry().catch(onBeforeRetryFailure);
    pendingWork = buildRetryWork(failures, lanesById);
    onRetry({
      attemptNumber: attemptIndex + 2,
      totalAttempts: attemptConcurrencies.length,
      concurrency: nextConcurrency,
      failedLaneProjectCount: failures.length,
    });
  }
};
