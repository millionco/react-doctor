import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";

import type { Snapshot } from "@vercel/sandbox";
import { createEvaluationSandbox } from "./utils/create-evaluation-sandbox.js";

import { createEvaluationSnapshot } from "./utils/create-evaluation-snapshot.js";
import type { EvaluationSnapshotBuild } from "./utils/create-evaluation-snapshot.js";
import { getSandboxCredentials } from "./utils/get-sandbox-credentials.js";
import { isSandboxNotFoundError } from "./utils/is-sandbox-not-found-error.js";

import { cleanupEvaluationSandboxes } from "./cleanup-evaluation-sandboxes.js";
import { deleteVercelSnapshotBeforeDeadline } from "./utils/delete-vercel-snapshot-before-deadline.js";
import {
  BUILD_PAIRED_REACT_DOCTOR_COMMANDS,
  BUILD_REACT_DOCTOR_COMMANDS,
  EVALUATION_RUN_NAME,
  EVALUATION_CLEANUP_RESERVE_MINUTES,
  EVALUATION_ARTIFACT_FILE_MODE,
  EVALUATION_RETRY_CONCURRENCIES,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
  PAIRED_SANDBOX_CPU_CORES,
  PAIRED_SCAN_MINIMUM_PARALLEL_CPU_CORES,
  PERCENT_MULTIPLIER,
  PREPARE_PAIRED_REACT_DOCTOR_COMMANDS,
  PREPARE_REACT_DOCTOR_COMMANDS,
  PROGRESS_INTERVAL_PROJECTS,
  REACT_DOCTOR_WORK_DIRECTORY,
  REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
  SANDBOX_CPU_CORES,
  SANDBOX_CREATE_CONCURRENCY,
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
import { createConcurrencyLimit } from "./utils/create-concurrency-limit.js";
import { getEvaluationAttemptDeadlineMilliseconds } from "./utils/get-evaluation-attempt-deadline-milliseconds.js";
import { getEvaluatorSourceHash } from "./utils/get-evaluator-source-hash.js";
import { toErrorMessage } from "./utils/to-error-message.js";
import { verifyEvaluationResourcesClean } from "./utils/verify-evaluation-resources-clean.js";
import { writeNdjsonRecord } from "./utils/write-ndjson-record.js";

const buildEvaluationSnapshotImage = (options: EvaluationOptions): EvaluationSnapshotBuild => {
  if (options.paired) {
    return {
      environment: {
        BASE_REACT_DOCTOR_REPOSITORY: options.paired.baseReactDoctorRepository,
        BASE_REACT_DOCTOR_REF: options.paired.baseReactDoctorRef,
        BASE_REACT_DOCTOR_RULE_KEYS: JSON.stringify(options.paired.baseRuleKeys),
        TREATMENT_REACT_DOCTOR_REPOSITORY: options.reactDoctorRepository,
        TREATMENT_REACT_DOCTOR_REF: options.reactDoctorRef,
        TREATMENT_REACT_DOCTOR_RULE_KEYS: JSON.stringify(options.ruleKeys),
      },
      commands: [...PREPARE_PAIRED_REACT_DOCTOR_COMMANDS, ...BUILD_PAIRED_REACT_DOCTOR_COMMANDS],
    };
  }
  return {
    environment: {
      REACT_DOCTOR_REPOSITORY: options.reactDoctorRepository,
      REACT_DOCTOR_REF: options.reactDoctorRef,
      REACT_DOCTOR_RULE_KEYS: JSON.stringify(options.ruleKeys),
      REACT_DOCTOR_WORK_DIRECTORY,
      REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
    },
    commands: [
      ...PREPARE_REACT_DOCTOR_COMMANDS,
      `cd "${REACT_DOCTOR_WORK_DIRECTORY}"`,
      ...BUILD_REACT_DOCTOR_COMMANDS,
    ],
  };
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

    const credentials = getSandboxCredentials();
    const evaluationId = randomUUID();
    const snapshotName = `${EVALUATION_RUN_NAME}-snapshot-${evaluationId}`;
    let snapshot: Snapshot | undefined;
    let evaluationError: unknown;
    let cleanupError: unknown;
    try {
      process.stderr.write(`Building React Doctor snapshot ${snapshotName}\n`);
      const snapshotStartedAt = globalThis.performance.now();
      snapshot = await createEvaluationSnapshot(
        {
          name: snapshotName,
          evaluationId,
          credentials,
          build: buildEvaluationSnapshotImage(options),
          resources: options.paired
            ? {
                cpu: PAIRED_SANDBOX_CPU_CORES,
              }
            : {
                cpu: SANDBOX_CPU_CORES,
              },
        },
        evaluationDeadlineMilliseconds,
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
      const limitSandboxCreation = createConcurrencyLimit(
        Math.min(options.concurrency, SANDBOX_CREATE_CONCURRENCY),
      );
      const snapshotId = snapshot.snapshotId;
      const createSandbox = (sandboxName: string, deadlineMilliseconds: number) =>
        limitSandboxCreation(() =>
          createEvaluationSandbox({
            credentials,
            name: sandboxName,
            snapshotId,
            evaluationId,
            cpuCores: options.paired ? PAIRED_SANDBOX_CPU_CORES : SANDBOX_CPU_CORES,
            deadlineMilliseconds,
          }),
        );
      await runEvaluationAttempts({
        repositoryGroups,
        repositoriesPerSandbox: options.repositoriesPerSandbox,
        attemptConcurrencies,
        evaluateRepositoryBatch: (repositoryBatch, attemptIndex) =>
          evaluateRepositoryBatch({
            credentials,
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
            credentials,
            evaluationId,
            deadlineMilliseconds: evaluationDeadlineMilliseconds,
          }),
        onBeforeRetryFailure: (error) => {
          process.stderr.write(
            `Failed to clean up Vercel sandboxes before retry: ${toErrorMessage(error)}\n`,
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
    } catch (error) {
      evaluationError = error;
    } finally {
      try {
        await cleanupEvaluationSandboxes({
          credentials,
          evaluationId,
          deadlineMilliseconds: wholeRunDeadlineMilliseconds,
        });
      } catch (error) {
        cleanupError = error;
      }
      try {
        await deleteVercelSnapshotBeforeDeadline({
          snapshot,
          credentials,
          snapshotName,
          deadlineMilliseconds: wholeRunDeadlineMilliseconds,
        });
      } catch (error) {
        if (!isSandboxNotFoundError(error)) cleanupError ??= error;
      }
      try {
        await verifyEvaluationResourcesClean({
          credentials,
          evaluationId,
          snapshotId: snapshot?.snapshotId,
          snapshotName,
          deadlineMilliseconds: wholeRunDeadlineMilliseconds,
        });
        cleanupError = undefined;
      } catch (error) {
        cleanupError = cleanupError
          ? new AggregateError([cleanupError, error], "Vercel cleanup was not verified")
          : error;
      }
    }
    if (evaluationError !== undefined && cleanupError !== undefined) {
      throw new AggregateError(
        [evaluationError, cleanupError],
        "Evaluation failed and Vercel cleanup was not verified",
      );
    }
    if (evaluationError !== undefined) throw evaluationError;
    if (cleanupError !== undefined) throw cleanupError;

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
