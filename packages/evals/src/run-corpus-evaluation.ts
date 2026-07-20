import { randomUUID } from "node:crypto";
import { once } from "node:events";

import { Daytona, DaytonaNotFoundError, Image } from "@daytona/sdk";
import pLimit from "p-limit";

import { cleanupEvaluationSandboxes } from "./cleanup-evaluation-sandboxes.js";
import {
  BUILD_REACT_DOCTOR_COMMANDS,
  EVALUATION_CLEANUP_RESERVE_MINUTES,
  EVALUATION_RETRY_CONCURRENCIES,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
  PERCENT_MULTIPLIER,
  PREPARE_REACT_DOCTOR_COMMANDS,
  PROGRESS_INTERVAL_PROJECTS,
  REACT_DOCTOR_WORK_DIRECTORY,
  SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
  SANDBOX_CPU_CORES,
  SANDBOX_CREATE_CONCURRENCY,
  SANDBOX_CREATE_TIMEOUT_SECONDS,
  SANDBOX_DISK_GIB,
  SANDBOX_IMAGE,
  SANDBOX_MEMORY_GIB,
  SANDBOX_SETUP_TIMEOUT_SECONDS,
  SUMMARY_DECIMAL_PLACES,
} from "./constants.js";
import type { CorpusEvaluationRecord } from "./corpus.js";
import { evaluateRepositoryBatch } from "./evaluate-repository-batch.js";
import { groupCorpusRepositories } from "./group-corpus-repositories.js";
import { loadCorpusRepositories } from "./load-corpus-repositories.js";
import type { EvaluationOptions } from "./parse-evaluation-arguments.js";
import { runEvaluationAttempts } from "./run-evaluation-attempts.js";
import { getEvaluationAttemptDeadlineMilliseconds } from "./utils/get-evaluation-attempt-deadline-milliseconds.js";
import { getEvaluationTimeoutSeconds } from "./utils/get-evaluation-timeout-seconds.js";
import { toErrorMessage } from "./utils/to-error-message.js";

export const runCorpusEvaluation = async (options: EvaluationOptions): Promise<void> => {
  const loadedRepositories = await loadCorpusRepositories(options.repositoriesSources);
  const repositoryGroups = groupCorpusRepositories(loadedRepositories)
    .slice(0, options.repositoryLimit)
    .map((repositoryGroup) => ({
      ...repositoryGroup,
      rootDirectories: repositoryGroup.rootDirectories.slice(0, options.projectRootsPerRepository),
    }));
  const projectCount = repositoryGroups.reduce(
    (totalProjectCount, repositoryGroup) =>
      totalProjectCount + repositoryGroup.rootDirectories.length,
    0,
  );
  const startedAt = globalThis.performance.now();
  const evaluationDeadlineMilliseconds =
    startedAt +
    (options.maxDurationMinutes - EVALUATION_CLEANUP_RESERVE_MINUTES) * MILLISECONDS_PER_MINUTE;
  let completedProjects = 0;
  let failedProjects = 0;

  process.stderr.write(
    `Evaluating ${projectCount} projects from ${repositoryGroups.length} repositories in batches of ${options.repositoriesPerSandbox} at concurrency ${options.concurrency}\n`,
  );

  const daytona = new Daytona();
  const evaluationId = randomUUID();
  const snapshotName = `react-doctor-eval-${evaluationId}`;
  try {
    process.stderr.write(`Building React Doctor snapshot ${snapshotName}\n`);
    await daytona.snapshot.create(
      {
        name: snapshotName,
        image: Image.base(SANDBOX_IMAGE)
          .env({
            REACT_DOCTOR_REPOSITORY: options.reactDoctorRepository,
            REACT_DOCTOR_REF: options.reactDoctorRef,
          })
          .runCommands(...PREPARE_REACT_DOCTOR_COMMANDS)
          .workdir(REACT_DOCTOR_WORK_DIRECTORY)
          .runCommands(...BUILD_REACT_DOCTOR_COMMANDS),
        resources: {
          cpu: SANDBOX_CPU_CORES,
          memory: SANDBOX_MEMORY_GIB,
          disk: SANDBOX_DISK_GIB,
        },
      },
      {
        timeout: getEvaluationTimeoutSeconds({
          deadlineMilliseconds: evaluationDeadlineMilliseconds,
          maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
        }),
      },
    );

    const recordEvaluation = async (record: CorpusEvaluationRecord): Promise<void> => {
      if (!process.stdout.write(`${JSON.stringify(record)}\n`)) {
        await once(process.stdout, "drain");
      }
      completedProjects += 1;
      if (record.error) failedProjects += 1;
      if (completedProjects % PROGRESS_INTERVAL_PROJECTS === 0) {
        process.stderr.write(`Processed ${completedProjects}/${projectCount} projects\n`);
      }
    };

    const attemptConcurrencies = [
      options.concurrency,
      ...EVALUATION_RETRY_CONCURRENCIES.map((concurrency) =>
        Math.min(options.concurrency, concurrency),
      ),
    ];
    const limitSandboxCreation = pLimit(Math.min(options.concurrency, SANDBOX_CREATE_CONCURRENCY));
    const createSandbox = (sandboxName: string, deadlineMilliseconds: number) =>
      limitSandboxCreation(() =>
        daytona.create(
          {
            name: sandboxName,
            snapshot: snapshotName,
            ephemeral: true,
            autoStopInterval: SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
            labels: {
              evaluation: evaluationId,
              project: "react-doctor",
              purpose: "eval-repository",
            },
          },
          {
            timeout: getEvaluationTimeoutSeconds({
              deadlineMilliseconds,
              maximumTimeoutSeconds: SANDBOX_CREATE_TIMEOUT_SECONDS,
            }),
          },
        ),
      );
    await runEvaluationAttempts({
      repositoryGroups,
      repositoriesPerSandbox: options.repositoriesPerSandbox,
      attemptConcurrencies,
      evaluateRepositoryBatch: (repositoryBatch, attemptIndex) =>
        evaluateRepositoryBatch({
          daytona,
          createSandbox,
          repositoryGroups: repositoryBatch,
          evaluationDeadlineMilliseconds: getEvaluationAttemptDeadlineMilliseconds({
            evaluationDeadlineMilliseconds,
            attemptIndex,
            totalAttempts: attemptConcurrencies.length,
          }),
          onRecord: recordEvaluation,
        }),
      beforeRetry: () => cleanupEvaluationSandboxes({ daytona, evaluationId }),
      onBeforeRetryFailure: (error) => {
        process.stderr.write(
          `Failed to clean up Daytona sandboxes before retry: ${toErrorMessage(error)}\n`,
        );
      },
      onRetry: (retry) => {
        process.stderr.write(
          `Retrying ${retry.failedProjectCount} projects at concurrency ${retry.concurrency} (attempt ${retry.attemptNumber}/${retry.totalAttempts})\n`,
        );
      },
      onFinalFailure: recordEvaluation,
    });
  } finally {
    try {
      await cleanupEvaluationSandboxes({ daytona, evaluationId });
    } finally {
      try {
        const snapshot = await daytona.snapshot.get(snapshotName);
        await daytona.snapshot.delete(snapshot);
      } catch (error) {
        if (!(error instanceof DaytonaNotFoundError)) {
          process.stderr.write(
            `Failed to delete Daytona snapshot ${snapshotName}: ${toErrorMessage(error)}\n`,
          );
        }
      }
    }
  }

  const successfulProjects = completedProjects - failedProjects;
  const completionRate = (successfulProjects / projectCount) * PERCENT_MULTIPLIER;
  const elapsedSeconds = (globalThis.performance.now() - startedAt) / MILLISECONDS_PER_SECOND;
  process.stderr.write(
    `Completion: ${completionRate.toFixed(SUMMARY_DECIMAL_PLACES)}% (${successfulProjects}/${projectCount}), failures: ${failedProjects}, elapsed: ${elapsedSeconds.toFixed(SUMMARY_DECIMAL_PLACES)}s\n`,
  );
  if (failedProjects !== 0) {
    throw new Error(`Evaluation failed for ${failedProjects} projects`);
  }
};
