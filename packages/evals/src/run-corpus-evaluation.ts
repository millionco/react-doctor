import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";

import { Daytona, DaytonaNotFoundError, Image } from "@daytona/sdk";
import pLimit from "p-limit";

import { cleanupEvaluationSandboxes } from "./cleanup-evaluation-sandboxes.js";
import { deleteDaytonaSnapshotBeforeDeadline } from "./utils/delete-daytona-snapshot-before-deadline.js";
import {
  BUILD_PAIRED_REACT_DOCTOR_COMMANDS,
  BUILD_REACT_DOCTOR_COMMANDS,
  DAYTONA_RUN_NAME,
  EVALUATION_CLEANUP_RESERVE_MINUTES,
  EVALUATION_ARTIFACT_FILE_MODE,
  EVALUATION_RETRY_CONCURRENCIES,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
  PAIRED_SANDBOX_CPU_CORES,
  PAIRED_SANDBOX_DISK_GIB,
  PAIRED_SANDBOX_MEMORY_GIB,
  PAIRED_SCAN_MINIMUM_PARALLEL_CPU_CORES,
  PERCENT_MULTIPLIER,
  PREPARE_PAIRED_REACT_DOCTOR_COMMANDS,
  PREPARE_REACT_DOCTOR_COMMANDS,
  PROGRESS_INTERVAL_PROJECTS,
  REACT_DOCTOR_WORK_DIRECTORY,
  REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
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
import type { PairedEvaluationRecords } from "./evaluate-repository-batch.js";
import { groupCorpusRepositories } from "./group-corpus-repositories.js";
import { loadCorpusRepositories } from "./load-corpus-repositories.js";
import type { EvaluationOptions } from "./parse-evaluation-arguments.js";
import { runEvaluationAttempts } from "./run-evaluation-attempts.js";
import { runMatrixCorpusEvaluation } from "./run-matrix-corpus-evaluation.js";
import { createPairedNdjsonWriter } from "./utils/create-paired-ndjson-writer.js";
import { getEvaluationAttemptDeadlineMilliseconds } from "./utils/get-evaluation-attempt-deadline-milliseconds.js";
import { getEvaluatorSourceHash } from "./utils/get-evaluator-source-hash.js";
import { getEvaluationTimeoutSeconds } from "./utils/get-evaluation-timeout-seconds.js";
import { toErrorMessage } from "./utils/to-error-message.js";
import { writeNdjsonRecord } from "./utils/write-ndjson-record.js";

const buildEvaluationSnapshotImage = (options: EvaluationOptions): Image => {
  if (options.paired) {
    return Image.base(SANDBOX_IMAGE)
      .env({
        BASE_REACT_DOCTOR_REPOSITORY: options.paired.baseReactDoctorRepository,
        BASE_REACT_DOCTOR_REF: options.paired.baseReactDoctorRef,
        BASE_REACT_DOCTOR_RULE_KEYS: JSON.stringify(options.paired.baseRuleKeys),
        TREATMENT_REACT_DOCTOR_REPOSITORY: options.reactDoctorRepository,
        TREATMENT_REACT_DOCTOR_REF: options.reactDoctorRef,
        TREATMENT_REACT_DOCTOR_RULE_KEYS: JSON.stringify(options.ruleKeys),
      })
      .runCommands(...PREPARE_PAIRED_REACT_DOCTOR_COMMANDS)
      .runCommands(...BUILD_PAIRED_REACT_DOCTOR_COMMANDS);
  }
  return Image.base(SANDBOX_IMAGE)
    .env({
      REACT_DOCTOR_REPOSITORY: options.reactDoctorRepository,
      REACT_DOCTOR_REF: options.reactDoctorRef,
      REACT_DOCTOR_RULE_KEYS: JSON.stringify(options.ruleKeys),
      REACT_DOCTOR_WORK_DIRECTORY,
      REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
    })
    .runCommands(...PREPARE_REACT_DOCTOR_COMMANDS)
    .workdir(REACT_DOCTOR_WORK_DIRECTORY)
    .runCommands(...BUILD_REACT_DOCTOR_COMMANDS);
};

const shouldRunPairedScansInParallel = (options: EvaluationOptions): boolean => {
  if (!options.paired || options.paired.execution === "sequential") return false;
  const hasAdequateCpu = PAIRED_SANDBOX_CPU_CORES >= PAIRED_SCAN_MINIMUM_PARALLEL_CPU_CORES;
  if (options.paired.execution === "parallel" && !hasAdequateCpu) {
    throw new Error(
      `Parallel paired evaluation requires at least ${PAIRED_SCAN_MINIMUM_PARALLEL_CPU_CORES} sandbox CPU cores`,
    );
  }
  return hasAdequateCpu;
};

export const runCorpusEvaluation = async (options: EvaluationOptions): Promise<void> => {
  if (options.matrix) return runMatrixCorpusEvaluation(options);
  const baselineFileHandle = options.paired
    ? await open(options.paired.baselineOutputPath, "wx", EVALUATION_ARTIFACT_FILE_MODE)
    : undefined;
  const writePairedRecords = baselineFileHandle
    ? createPairedNdjsonWriter({
        baselineFileHandle,
        treatmentOutput: process.stdout,
      })
    : undefined;
  try {
    const loadedRepositories = await loadCorpusRepositories(options.repositoriesSources);
    const repositoryGroups = groupCorpusRepositories(loadedRepositories)
      .slice(0, options.repositoryLimit)
      .map((repositoryGroup) => ({
        ...repositoryGroup,
        rootDirectories: repositoryGroup.rootDirectories.slice(
          0,
          options.projectRootsPerRepository,
        ),
      }));
    const projectCount = repositoryGroups.reduce(
      (totalProjectCount, repositoryGroup) =>
        totalProjectCount + repositoryGroup.rootDirectories.length,
      0,
    );
    const startedAt = globalThis.performance.now();
    const evaluatorSourceHash = getEvaluatorSourceHash();
    const wholeRunDeadlineMilliseconds =
      startedAt + options.maxDurationMinutes * MILLISECONDS_PER_MINUTE;
    const evaluationDeadlineMilliseconds =
      wholeRunDeadlineMilliseconds - EVALUATION_CLEANUP_RESERVE_MINUTES * MILLISECONDS_PER_MINUTE;
    let completedProjects = 0;
    let failedProjects = 0;
    const runPairedScansInParallel = shouldRunPairedScansInParallel(options);

    process.stderr.write(
      `Evaluating ${projectCount} projects from ${repositoryGroups.length} repositories in batches of ${options.repositoriesPerSandbox} at concurrency ${options.concurrency}\n`,
    );

    const daytona = new Daytona();
    const evaluationId = randomUUID();
    const snapshotName = `${DAYTONA_RUN_NAME}-snapshot-${evaluationId}`;
    try {
      process.stderr.write(`Building React Doctor snapshot ${snapshotName}\n`);
      const snapshotStartedAt = globalThis.performance.now();
      await daytona.snapshot.create(
        {
          name: snapshotName,
          image: buildEvaluationSnapshotImage(options),
          resources: options.paired
            ? {
                cpu: PAIRED_SANDBOX_CPU_CORES,
                memory: PAIRED_SANDBOX_MEMORY_GIB,
                disk: PAIRED_SANDBOX_DISK_GIB,
              }
            : {
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
      const snapshotSetupSeconds =
        (globalThis.performance.now() - snapshotStartedAt) / MILLISECONDS_PER_SECOND;
      process.stderr.write(
        `Snapshot ready in ${snapshotSetupSeconds.toFixed(SUMMARY_DECIMAL_PLACES)}s\n`,
      );

      const recordEvaluation = async (record: CorpusEvaluationRecord): Promise<void> => {
        await writeNdjsonRecord(process.stdout, record);
        completedProjects += 1;
        if (record.error) failedProjects += 1;
        if (completedProjects % PROGRESS_INTERVAL_PROJECTS === 0) {
          process.stderr.write(`Processed ${completedProjects}/${projectCount} projects\n`);
        }
      };
      const recordPairedEvaluation = async ({
        baseline,
        treatment,
      }: PairedEvaluationRecords): Promise<void> => {
        if (!writePairedRecords) {
          throw new Error("Paired record writer is missing");
        }
        await writePairedRecords({
          baselineRecord: baseline,
          treatmentRecord: treatment,
        });
        completedProjects += 1;
        if (treatment.error) failedProjects += 1;
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
      const limitSandboxCreation = pLimit(
        Math.min(options.concurrency, SANDBOX_CREATE_CONCURRENCY),
      );
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
                project: DAYTONA_RUN_NAME,
                purpose: "eval-repository",
                run: DAYTONA_RUN_NAME,
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
            evaluatorSourceHash,
            evaluationDeadlineMilliseconds: getEvaluationAttemptDeadlineMilliseconds({
              evaluationDeadlineMilliseconds,
              attemptIndex,
              totalAttempts: attemptConcurrencies.length,
            }),
            onRecord: recordEvaluation,
            paired: options.paired
              ? {
                  runScansInParallel: runPairedScansInParallel,
                  onPairedRecords: recordPairedEvaluation,
                }
              : undefined,
          }),
        beforeRetry: () =>
          cleanupEvaluationSandboxes({
            daytona,
            evaluationId,
            deadlineMilliseconds: evaluationDeadlineMilliseconds,
          }),
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
        onFinalFailure: async (record) => {
          if (options.paired) {
            await recordPairedEvaluation({ baseline: record, treatment: record });
          } else {
            await recordEvaluation(record);
          }
        },
      });
    } finally {
      try {
        await cleanupEvaluationSandboxes({
          daytona,
          evaluationId,
          deadlineMilliseconds: wholeRunDeadlineMilliseconds,
        });
      } finally {
        try {
          await deleteDaytonaSnapshotBeforeDeadline({
            snapshotClient: daytona.snapshot,
            snapshotName,
            deadlineMilliseconds: wholeRunDeadlineMilliseconds,
          });
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
  } finally {
    await baselineFileHandle?.close();
  }
};
