import { randomUUID } from "node:crypto";

import { DaytonaNotFoundError } from "@daytona/sdk";
import type { Daytona, Sandbox } from "@daytona/sdk";

import {
  DAYTONA_RUN_NAME,
  EVALUATION_SCHEMA_VERSION,
  PAIRED_SANDBOX_SCAN_TIMEOUT_SECONDS,
  RESOLVE_MATRIX_TARGET_REPOSITORY_REF_COMMAND,
  SANDBOX_DELETE_TIMEOUT_SECONDS,
  SANDBOX_REPORT_DOWNLOAD_TIMEOUT_SECONDS,
  SANDBOX_SETUP_TIMEOUT_SECONDS,
  SETUP_MATRIX_TARGET_REPOSITORY_COMMAND,
} from "./constants.js";
import type { CorpusEvaluationRecord, CorpusRepositoryGroup } from "./corpus.js";
import type { MatrixEvaluationLane } from "./build-matrix-evaluation-plan.js";
import {
  buildFailureRecords,
  buildRepositories,
  scanRepository,
} from "./evaluate-repository-batch.js";
import { executeSandboxCommand } from "./execute-sandbox-command.js";
import {
  EvaluationDeadlineExceededError,
  getEvaluationTimeoutSeconds,
} from "./utils/get-evaluation-timeout-seconds.js";
import { parseReactDoctorEvaluationProvenance } from "./utils/parse-react-doctor-evaluation-provenance.js";
import { runBeforeDeadline } from "./utils/run-before-deadline.js";
import { toErrorMessage } from "./utils/to-error-message.js";

export interface MatrixEvaluationFailure {
  laneId: string;
  record: CorpusEvaluationRecord;
}

export interface EvaluateMatrixRepositoryBatchInput {
  daytona: Daytona;
  createSandbox: (sandboxName: string, deadlineMilliseconds: number) => Promise<Sandbox>;
  repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>;
  lanes: ReadonlyArray<MatrixEvaluationLane>;
  waveWidth: number;
  evaluationDeadlineMilliseconds: number;
  evaluatorSourceHash: string;
  onLaneRecord: (laneId: string, record: CorpusEvaluationRecord) => Promise<void>;
}

const buildLaneFailures = (
  lanes: ReadonlyArray<MatrixEvaluationLane>,
  repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>,
  error: unknown,
): ReadonlyArray<MatrixEvaluationFailure> =>
  lanes.flatMap((lane) =>
    repositoryGroups.flatMap((repositoryGroup) =>
      buildFailureRecords(buildRepositories(repositoryGroup), error).map((record) => ({
        laneId: lane.id,
        record,
      })),
    ),
  );

const partitionLanes = (
  lanes: ReadonlyArray<MatrixEvaluationLane>,
  waveWidth: number,
): ReadonlyArray<ReadonlyArray<MatrixEvaluationLane>> => {
  const waves: MatrixEvaluationLane[][] = [];
  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += waveWidth) {
    waves.push(lanes.slice(laneIndex, laneIndex + waveWidth));
  }
  return waves;
};

export const evaluateMatrixRepositoryBatch = async ({
  daytona,
  createSandbox,
  repositoryGroups,
  lanes,
  waveWidth,
  evaluationDeadlineMilliseconds,
  evaluatorSourceHash,
  onLaneRecord,
}: EvaluateMatrixRepositoryBatchInput): Promise<ReadonlyArray<MatrixEvaluationFailure>> => {
  const sandboxName = `${DAYTONA_RUN_NAME}-${randomUUID()}`;
  let sandbox: Sandbox | undefined;
  let shouldRecoverSandbox = true;
  try {
    try {
      sandbox = await createSandbox(sandboxName, evaluationDeadlineMilliseconds);
    } catch (error) {
      shouldRecoverSandbox = !(error instanceof EvaluationDeadlineExceededError);
      return buildLaneFailures(lanes, repositoryGroups, error);
    }
    const activeSandbox = sandbox;
    const provenanceResults = await Promise.allSettled(
      lanes.map(async (lane) => {
        const contents = await activeSandbox.fs.downloadFile(
          lane.provenancePath,
          getEvaluationTimeoutSeconds({
            deadlineMilliseconds: evaluationDeadlineMilliseconds,
            maximumTimeoutSeconds: SANDBOX_REPORT_DOWNLOAD_TIMEOUT_SECONDS,
          }),
        );
        const provenance = parseReactDoctorEvaluationProvenance(contents.toString("utf8"));
        if (
          provenance.reactDoctorRepository !== lane.reactDoctorRepository ||
          provenance.reactDoctorCommit !== lane.reactDoctorRef ||
          JSON.stringify(provenance.ruleKeys) !== JSON.stringify(lane.ruleKeys)
        ) {
          throw new Error(`Matrix lane provenance does not match its descriptor: ${lane.id}`);
        }
        return {
          lane,
          provenance: {
            ...provenance,
            evaluatorSourceHash,
          },
        };
      }),
    );
    const readyLanes = provenanceResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failures: MatrixEvaluationFailure[] = provenanceResults.flatMap((result, laneIndex) =>
      result.status === "rejected"
        ? buildLaneFailures([lanes[laneIndex]], repositoryGroups, result.reason)
        : [],
    );
    if (readyLanes.length === 0) return failures;

    for (const repositoryGroup of repositoryGroups) {
      let repositories = buildRepositories(repositoryGroup);
      try {
        await executeSandboxCommand({
          sandbox: activeSandbox,
          command: SETUP_MATRIX_TARGET_REPOSITORY_COMMAND,
          environment: {
            TARGET_REPOSITORY: `https://github.com/${repositoryGroup.org}/${repositoryGroup.name}.git`,
            TARGET_REF: repositoryGroup.ref,
            MATRIX_ACTIVE_LANE_IDS: JSON.stringify(readyLanes.map(({ lane }) => lane.id)),
          },
          timeoutSeconds: getEvaluationTimeoutSeconds({
            deadlineMilliseconds: evaluationDeadlineMilliseconds,
            maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
          }),
          description: `Clone ${repositoryGroup.org}/${repositoryGroup.name}`,
        });
        const resolvedRef = (
          await executeSandboxCommand({
            sandbox: activeSandbox,
            command: RESOLVE_MATRIX_TARGET_REPOSITORY_REF_COMMAND,
            environment: {},
            timeoutSeconds: getEvaluationTimeoutSeconds({
              deadlineMilliseconds: evaluationDeadlineMilliseconds,
              maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
            }),
            description: `Resolve ${repositoryGroup.org}/${repositoryGroup.name}`,
          })
        ).output.trim();
        repositories = repositories.map((repository) => ({ ...repository, ref: resolvedRef }));
      } catch (error) {
        failures.push(
          ...buildLaneFailures(
            readyLanes.map(({ lane }) => lane),
            [repositoryGroup],
            error,
          ),
        );
        continue;
      }

      for (const repository of repositories) {
        for (const wave of partitionLanes(
          readyLanes.map(({ lane }) => lane),
          waveWidth,
        )) {
          const waveResults = await Promise.allSettled(
            wave.map(async (lane) => {
              const readyLane = readyLanes.find((candidate) => candidate.lane.id === lane.id);
              if (!readyLane) throw new Error(`Matrix lane provenance is missing: ${lane.id}`);
              const report = await scanRepository({
                sandbox: activeSandbox,
                repository,
                reactDoctorWorkDirectory: lane.reactDoctorWorkDirectory,
                reactDoctorRuleKeys: readyLane.provenance.ruleKeys,
                targetWorkDirectory: lane.targetWorkDirectory,
                reportPath: lane.reportPath,
                evaluationDeadlineMilliseconds,
                descriptionPrefix: `Scan ${lane.id}`,
                scanTimeoutSeconds: PAIRED_SANDBOX_SCAN_TIMEOUT_SECONDS,
              });
              await onLaneRecord(lane.id, {
                schemaVersion: EVALUATION_SCHEMA_VERSION,
                repository,
                evaluation: readyLane.provenance,
                report,
              });
            }),
          );
          for (const [waveLaneIndex, result] of waveResults.entries()) {
            if (result.status === "rejected") {
              const lane = wave[waveLaneIndex];
              failures.push({
                laneId: lane.id,
                record: buildFailureRecords([repository], result.reason)[0],
              });
            }
          }
        }
      }
    }
    return failures;
  } finally {
    let sandboxToDelete = sandbox;
    if (!sandboxToDelete && shouldRecoverSandbox) {
      try {
        sandboxToDelete = await runBeforeDeadline({
          operation: () => daytona.get(sandboxName),
          deadlineMilliseconds: evaluationDeadlineMilliseconds,
          timeoutMessage: `Timed out recovering Daytona sandbox ${sandboxName}`,
        });
      } catch (error) {
        if (!(error instanceof DaytonaNotFoundError)) {
          process.stderr.write(
            `Failed to recover Daytona sandbox ${sandboxName}: ${toErrorMessage(error)}\n`,
          );
        }
      }
    }
    if (sandboxToDelete) {
      try {
        await runBeforeDeadline({
          operation: () => daytona.delete(sandboxToDelete, SANDBOX_DELETE_TIMEOUT_SECONDS),
          deadlineMilliseconds: evaluationDeadlineMilliseconds,
          timeoutMessage: `Timed out deleting Daytona sandbox ${sandboxToDelete.id}`,
        });
      } catch (error) {
        process.stderr.write(
          `Failed to delete Daytona sandbox ${sandboxToDelete.id}: ${toErrorMessage(error)}\n`,
        );
      }
    }
  }
};
