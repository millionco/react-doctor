import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Daytona, DaytonaNotFoundError, Image } from "@daytona/sdk";
import pLimit from "p-limit";

import { buildMatrixEvaluationPlan } from "./build-matrix-evaluation-plan.js";
import type { MatrixEvaluationLane } from "./build-matrix-evaluation-plan.js";
import { cleanupEvaluationSandboxes } from "./cleanup-evaluation-sandboxes.js";
import {
  DAYTONA_RUN_NAME,
  EVALUATION_CLEANUP_RESERVE_MINUTES,
  EVALUATION_CONFIG_CONTRACT,
  EVALUATION_RETRY_CONCURRENCIES,
  MATERIALIZE_REACT_DOCTOR_EVALUATION_PROVENANCE_COMMAND,
  MATRIX_CLEANUP_VERIFICATION_TIMEOUT_SECONDS,
  MATRIX_LOCAL_COMMAND_TIMEOUT_SECONDS,
  MATRIX_PROVENANCE_DIRECTORY,
  MATRIX_REACT_DOCTOR_DIRECTORY,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
  SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
  SANDBOX_CREATE_CONCURRENCY,
  SANDBOX_CREATE_TIMEOUT_SECONDS,
  SANDBOX_IMAGE,
  SANDBOX_SETUP_TIMEOUT_SECONDS,
} from "./constants.js";
import type { CorpusEvaluationRecord, EvaluationProvenance } from "./corpus.js";
import { evaluateMatrixRepositoryBatch } from "./evaluate-matrix-repository-batch.js";
import { groupCorpusRepositories } from "./group-corpus-repositories.js";
import { createAtomicNdjsonWriter, createMatrixArtifactWriter } from "./matrix-artifact.js";
import type { MatrixArtifactWriter } from "./matrix-artifact.js";
import type { EvaluationOptions } from "./parse-evaluation-arguments.js";
import { runMatrixEvaluationAttempts } from "./run-matrix-evaluation-attempts.js";
import { assertMatrixBaseRecord } from "./utils/assert-matrix-base-record.js";
import { createMatrixBaseArtifactBinding } from "./utils/matrix-base-artifact-binding.js";
import type { MatrixBaseArtifactBinding } from "./utils/matrix-base-artifact-binding.js";
import { getEvaluationAttemptDeadlineMilliseconds } from "./utils/get-evaluation-attempt-deadline-milliseconds.js";
import { getEvaluationTimeoutSeconds } from "./utils/get-evaluation-timeout-seconds.js";
import { getEvaluatorSourceHash } from "./utils/get-evaluator-source-hash.js";
import { parseMatrixCorpusManifest } from "./utils/parse-matrix-corpus-manifest.js";
import { toErrorMessage } from "./utils/to-error-message.js";
import { verifyMatrixResourcesClean } from "./utils/verify-matrix-resources-clean.js";
import { hashMatrixCorpusProjectSet, loadMatrixTreatments } from "./matrix-treatment-descriptor.js";
import type { MatrixBaselineArtifactVerification } from "./verify-matrix-baseline-cache.js";
import {
  parseMatrixBaselineVerifierOutput,
  verifyMatrixBaselineCache,
} from "./verify-matrix-baseline-cache.js";
import { verifyMatrixImpactManifests } from "./verify-matrix-impact-manifests.js";

const executeFile = promisify(execFile);

const hashBytes = (contents: Buffer): string => createHash("sha256").update(contents).digest("hex");

const buildMatrixSnapshotImage = (lanes: ReadonlyArray<MatrixEvaluationLane>): Image => {
  const environment: Record<string, string> = {};
  const prepareCommands: string[] = [];
  const buildCommands: string[] = ["corepack enable"];
  for (const [laneIndex, lane] of lanes.entries()) {
    const repositoryVariable = `MATRIX_LANE_${laneIndex}_REPOSITORY`;
    const refVariable = `MATRIX_LANE_${laneIndex}_REF`;
    environment[repositoryVariable] = lane.reactDoctorRepository;
    environment[refVariable] = lane.reactDoctorRef;
    prepareCommands.push(
      `mkdir -p "${lane.reactDoctorWorkDirectory}" "${MATRIX_PROVENANCE_DIRECTORY}"`,
      `git -C "${lane.reactDoctorWorkDirectory}" init -q`,
      `git -C "${lane.reactDoctorWorkDirectory}" remote add origin "$${repositoryVariable}"`,
      `git -C "${lane.reactDoctorWorkDirectory}" fetch -q --depth 1 origin "$${refVariable}"`,
      `git -C "${lane.reactDoctorWorkDirectory}" checkout -q --detach FETCH_HEAD`,
    );
    buildCommands.push(
      `cd "${lane.reactDoctorWorkDirectory}" && npx --yes --package @antfu/ni ni --frozen`,
      `cd "${lane.reactDoctorWorkDirectory}" && ./node_modules/.bin/turbo run build --filter=react-doctor`,
      `REACT_DOCTOR_WORK_DIRECTORY="${lane.reactDoctorWorkDirectory}" REACT_DOCTOR_REPOSITORY="$${repositoryVariable}" REACT_DOCTOR_RULE_KEYS='${JSON.stringify(lane.ruleKeys)}' REACT_DOCTOR_EVALUATION_PROVENANCE_PATH="${lane.provenancePath}" ${MATERIALIZE_REACT_DOCTOR_EVALUATION_PROVENANCE_COMMAND}`,
    );
  }
  return Image.base(SANDBOX_IMAGE)
    .env(environment)
    .runCommands(...prepareCommands)
    .runCommands(...buildCommands)
    .workdir(MATRIX_REACT_DOCTOR_DIRECTORY);
};

const createFullBaselineProvenance = async ({
  baselineOutputPath,
  baselineProvenancePath,
  corpusManifestPath,
  baseReactDoctorCommit,
  baseReactDoctorRepository,
  evaluatorSourceHash,
  baseFullRuleSetHash,
  deadlineMilliseconds,
}: {
  baselineOutputPath: string;
  baselineProvenancePath: string;
  corpusManifestPath: string;
  baseReactDoctorCommit: string;
  baseReactDoctorRepository: string;
  evaluatorSourceHash: string;
  baseFullRuleSetHash: string;
  deadlineMilliseconds: number;
}): Promise<MatrixBaselineArtifactVerification> => {
  const verifierPath = fileURLToPath(
    new URL(
      "../../../.agents/skills/run-parity/scripts/baseline-cache-provenance.mjs",
      import.meta.url,
    ),
  );
  const { stdout } = await executeFile(
    process.execPath,
    [
      verifierPath,
      "create",
      "--baseline",
      baselineOutputPath,
      "--provenance",
      baselineProvenancePath,
      "--corpus-manifest",
      corpusManifestPath,
      "--base-commit",
      baseReactDoctorCommit,
      "--repository",
      baseReactDoctorRepository,
      "--evaluator-source-hash",
      evaluatorSourceHash,
      "--config-contract",
      EVALUATION_CONFIG_CONTRACT,
      "--rule-set-hash",
      baseFullRuleSetHash,
    ],
    {
      timeout:
        getEvaluationTimeoutSeconds({
          deadlineMilliseconds,
          maximumTimeoutSeconds: MATRIX_LOCAL_COMMAND_TIMEOUT_SECONDS,
        }) * MILLISECONDS_PER_SECOND,
    },
  );
  return parseMatrixBaselineVerifierOutput(stdout);
};

export const runMatrixCorpusEvaluation = async (options: EvaluationOptions): Promise<void> => {
  const matrixOptions = options.matrix;
  if (!matrixOptions) throw new Error("Matrix evaluation options are missing");
  const startedAt = globalThis.performance.now();
  const wholeRunDeadlineMilliseconds =
    startedAt + options.maxDurationMinutes * MILLISECONDS_PER_MINUTE;
  const evaluationDeadlineMilliseconds =
    wholeRunDeadlineMilliseconds - EVALUATION_CLEANUP_RESERVE_MINUTES * MILLISECONDS_PER_MINUTE;
  const treatments = await loadMatrixTreatments(matrixOptions.treatmentDescriptorPaths);
  await verifyMatrixImpactManifests(treatments, evaluationDeadlineMilliseconds);
  const group = treatments[0].descriptor.group;
  const evaluatorSourceHash = getEvaluatorSourceHash();
  if (group.evaluatorSourceHash !== evaluatorSourceHash) {
    throw new Error("Matrix descriptor evaluatorSourceHash does not match this checkout");
  }
  const corpusContents = await readFile(group.corpusManifestPath);
  if (hashBytes(corpusContents) !== group.corpusManifestSha256) {
    throw new Error("Matrix corpus manifest hash does not match the descriptor group");
  }
  const loadedRepositories = parseMatrixCorpusManifest(corpusContents);
  if (hashMatrixCorpusProjectSet(loadedRepositories) !== group.corpusProjectSetSha256) {
    throw new Error("Matrix corpus project tuple set does not match the descriptor group");
  }
  const repositoryGroups = groupCorpusRepositories(loadedRepositories);
  const projectCount = loadedRepositories.length;
  const cacheVerification = await verifyMatrixBaselineCache(group, evaluationDeadlineMilliseconds);
  if (cacheVerification.invalid) {
    throw new Error(`Matrix baseline cache is invalid: ${cacheVerification.reason}`);
  }
  if (cacheVerification.hit && !cacheVerification.artifact) {
    throw new Error("Matrix baseline cache verifier omitted its artifact binding");
  }
  process.stderr.write(
    cacheVerification.hit
      ? `Validated full baseline cache ${group.baselineOutputPath}; skipping base scans\n`
      : `Full baseline cache miss (${cacheVerification.reason}); scanning base once\n`,
  );
  const plan = buildMatrixEvaluationPlan({
    treatments,
    waveWidth: matrixOptions.waveWidth,
    hasVerifiedFullBaseline: cacheVerification.hit,
  });
  let baseArtifactBinding: MatrixBaseArtifactBinding | undefined = cacheVerification.hit
    ? await createMatrixBaseArtifactBinding({
        sourcePath: group.baselineOutputPath,
        provenanceSourcePath: group.baselineProvenancePath,
        expected: cacheVerification.artifact,
        producer: {
          reactDoctorRepository: group.baseReactDoctorRepository,
          reactDoctorCommit: group.baseReactDoctorCommit,
          configContract: group.configContract,
          ruleSetHash: group.baseFullRuleSetHash,
          ruleKeys: [],
          evaluatorSourceHash,
        },
      })
    : undefined;
  const evaluationId = randomUUID();
  const baseLane = plan.lanes.find((lane) => lane.kind === "base");
  if (!cacheVerification.hit && !baseLane) {
    throw new Error("Matrix cache miss requires a base lane");
  }
  let baseOutputPath = group.baselineOutputPath;
  if (!cacheVerification.hit && baseLane && baseLane.ruleKeys.length !== 0) {
    baseOutputPath = group.baseArtifactPath;
  }
  const artifactWriterEntries: Array<readonly [string, MatrixArtifactWriter]> = [];
  try {
    for (const treatment of treatments) {
      const writer = await createMatrixArtifactWriter({
        evaluationId,
        treatment,
        expectedProjectCount: projectCount,
        corpusManifestContents: corpusContents,
      });
      artifactWriterEntries.push([treatment.descriptor.id, writer]);
    }
  } catch (error) {
    await Promise.all(artifactWriterEntries.map(([, writer]) => writer.abort()));
    throw error;
  }
  const artifactWriters = new Map(artifactWriterEntries);
  let baseWriter;
  try {
    baseWriter = baseLane
      ? await createAtomicNdjsonWriter({ outputPath: baseOutputPath, evaluationId })
      : undefined;
  } catch (error) {
    await Promise.all([...artifactWriters.values()].map((writer) => writer.abort()));
    throw error;
  }
  const failedRecordCounts = new Map(plan.lanes.map((lane) => [lane.id, 0]));
  const completedRecordCounts = new Map(plan.lanes.map((lane) => [lane.id, 0]));
  const daytona = new Daytona();
  const snapshotName = `${DAYTONA_RUN_NAME}-snapshot-${evaluationId}`;
  let didCompleteEvaluation = false;
  let evaluationError: unknown;
  let cleanupError: unknown;
  let baseEvaluation: EvaluationProvenance | undefined;
  try {
    process.stderr.write(
      `Evaluating ${projectCount} projects across ${plan.lanes.length} active lanes in waves of ${plan.waveWidth}\n`,
    );
    await daytona.snapshot.create(
      {
        name: snapshotName,
        image: buildMatrixSnapshotImage(plan.lanes),
        resources: plan.resources,
      },
      {
        timeout: getEvaluationTimeoutSeconds({
          deadlineMilliseconds: evaluationDeadlineMilliseconds,
          maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
        }),
      },
    );
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
              project: DAYTONA_RUN_NAME,
              purpose: "eval-repository-matrix",
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
    const recordLaneEvaluation = async (
      laneId: string,
      record: CorpusEvaluationRecord,
    ): Promise<void> => {
      if (laneId === baseLane?.id) {
        if (!baseWriter) throw new Error("Matrix base writer is missing");
        assertMatrixBaseRecord({
          record,
          expectedRuleSetHash: group.baseFullRuleSetHash,
          isFullRuleSet: baseLane.ruleKeys.length === 0,
        });
        if (record.evaluation) baseEvaluation = record.evaluation;
        await baseWriter.write(record);
      } else {
        const writer = artifactWriters.get(laneId);
        if (!writer) throw new Error(`Matrix artifact writer is missing: ${laneId}`);
        await writer.write(record);
      }
      completedRecordCounts.set(laneId, (completedRecordCounts.get(laneId) ?? 0) + 1);
      if (record.error) failedRecordCounts.set(laneId, (failedRecordCounts.get(laneId) ?? 0) + 1);
    };
    await runMatrixEvaluationAttempts({
      repositoryGroups,
      lanes: plan.lanes,
      repositoriesPerSandbox: options.repositoriesPerSandbox,
      attemptConcurrencies,
      evaluateRepositoryBatch: (repositoryBatch, lanes, attemptIndex) =>
        evaluateMatrixRepositoryBatch({
          daytona,
          createSandbox,
          repositoryGroups: repositoryBatch,
          lanes,
          waveWidth: Math.min(plan.waveWidth, lanes.length),
          evaluatorSourceHash,
          evaluationDeadlineMilliseconds: getEvaluationAttemptDeadlineMilliseconds({
            evaluationDeadlineMilliseconds,
            attemptIndex,
            totalAttempts: attemptConcurrencies.length,
          }),
          onLaneRecord: recordLaneEvaluation,
        }),
      beforeRetry: () => cleanupEvaluationSandboxes({ daytona, evaluationId }),
      onBeforeRetryFailure: (error) => {
        process.stderr.write(
          `Failed to clean matrix sandboxes before retry: ${toErrorMessage(error)}\n`,
        );
      },
      onRetry: (retry) => {
        process.stderr.write(
          `Retrying ${retry.failedLaneProjectCount} lane-projects at concurrency ${retry.concurrency} (attempt ${retry.attemptNumber}/${retry.totalAttempts})\n`,
        );
      },
      onFinalFailure: ({ laneId, record }) => recordLaneEvaluation(laneId, record),
    });
    didCompleteEvaluation = true;
  } catch (error) {
    evaluationError = error;
  } finally {
    try {
      await cleanupEvaluationSandboxes({ daytona, evaluationId });
    } catch (error) {
      cleanupError = error;
    } finally {
      try {
        const snapshot = await daytona.snapshot.get(snapshotName);
        await daytona.snapshot.delete(snapshot);
      } catch (error) {
        if (!(error instanceof DaytonaNotFoundError)) {
          process.stderr.write(
            `Failed to delete Daytona snapshot ${snapshotName}: ${toErrorMessage(error)}\n`,
          );
          cleanupError ??= error;
        }
      }
      try {
        await verifyMatrixResourcesClean({
          daytona,
          evaluationId,
          snapshotName,
          deadlineMilliseconds: Math.min(
            wholeRunDeadlineMilliseconds,
            globalThis.performance.now() +
              MATRIX_CLEANUP_VERIFICATION_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND,
          ),
        });
        cleanupError = undefined;
      } catch (error) {
        cleanupError = cleanupError
          ? new AggregateError([cleanupError, error], "Matrix Daytona cleanup was not verified")
          : error;
      }
    }
  }

  if (evaluationError !== undefined) {
    await Promise.all([...artifactWriters.values()].map((writer) => writer.abort()));
    if (baseWriter) await baseWriter.abort();
    throw evaluationError;
  }

  const baseFailedRecordCount = baseLane ? (failedRecordCounts.get(baseLane.id) ?? 0) : 0;
  const baseCompletedRecordCount = baseLane ? (completedRecordCounts.get(baseLane.id) ?? 0) : 0;
  let isBaselineAvailable = cacheVerification.hit;
  if (baseWriter) {
    if (
      !didCompleteEvaluation ||
      baseFailedRecordCount !== 0 ||
      baseCompletedRecordCount !== projectCount
    ) {
      await baseWriter.abort();
    } else {
      await baseWriter.finalize();
      isBaselineAvailable = true;
      if (baseLane?.ruleKeys.length === 0) {
        try {
          const baselineVerification = await createFullBaselineProvenance({
            baselineOutputPath: baseOutputPath,
            baselineProvenancePath: group.baselineProvenancePath,
            corpusManifestPath: group.corpusManifestPath,
            baseReactDoctorCommit: group.baseReactDoctorCommit,
            baseReactDoctorRepository: group.baseReactDoctorRepository,
            evaluatorSourceHash,
            baseFullRuleSetHash: group.baseFullRuleSetHash,
            deadlineMilliseconds: wholeRunDeadlineMilliseconds,
          });
          if (!baseEvaluation) throw new Error("Matrix base evaluation provenance is missing");
          baseArtifactBinding = await createMatrixBaseArtifactBinding({
            sourcePath: baseOutputPath,
            provenanceSourcePath: group.baselineProvenancePath,
            producer: baseEvaluation,
            expected: baselineVerification,
          });
        } catch (error) {
          isBaselineAvailable = false;
          evaluationError = error;
          await Promise.all([
            rm(baseOutputPath, { force: true }),
            rm(group.baselineProvenancePath, { force: true }),
            rm(`${group.baselineProvenancePath}.tmp`, { force: true }),
          ]);
        }
      } else if (baseEvaluation) {
        try {
          baseArtifactBinding = await createMatrixBaseArtifactBinding({
            sourcePath: baseOutputPath,
            producer: baseEvaluation,
          });
        } catch (error) {
          isBaselineAvailable = false;
          evaluationError = error;
        }
      }
    }
  }
  const finalizationResults = await Promise.allSettled(
    [...artifactWriters.values()].map((writer) => writer.finalize(baseArtifactBinding)),
  );
  const artifactFinalizationFailure = finalizationResults.find(
    (result) => result.status === "rejected",
  );
  if (artifactFinalizationFailure?.status === "rejected") {
    const artifactWriterList = [...artifactWriters.values()];
    await Promise.all(
      finalizationResults.flatMap((result, resultIndex) =>
        result.status === "rejected" ? [artifactWriterList[resultIndex].abort()] : [],
      ),
    );
    if (baseWriter && !isBaselineAvailable) await baseWriter.abort();
    throw artifactFinalizationFailure.reason;
  }
  const hasBlockedArtifact = finalizationResults.some(
    (result) => result.status === "fulfilled" && result.value.status === "blocked",
  );
  const failedLanes = plan.lanes.filter(
    (lane) =>
      (failedRecordCounts.get(lane.id) ?? 0) !== 0 ||
      (completedRecordCounts.get(lane.id) ?? 0) !== projectCount,
  );
  if (evaluationError !== undefined) throw evaluationError;
  if (
    !didCompleteEvaluation ||
    failedLanes.length !== 0 ||
    !isBaselineAvailable ||
    hasBlockedArtifact
  ) {
    throw new Error(
      `Matrix evaluation failed for lanes: ${failedLanes.map((lane) => lane.id).join(", ")}`,
    );
  }
  if (cleanupError !== undefined) throw cleanupError;
};
