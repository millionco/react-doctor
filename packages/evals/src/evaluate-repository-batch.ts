import { randomUUID } from "node:crypto";

import { DaytonaNotFoundError } from "@daytona/sdk";
import type { Daytona, Sandbox } from "@daytona/sdk";

import {
  DAYTONA_RUN_NAME,
  EVALUATION_SCHEMA_VERSION,
  REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
  RESOLVE_TARGET_REPOSITORY_REF_COMMAND,
  SANDBOX_DELETE_TIMEOUT_SECONDS,
  SANDBOX_REPORT_DOWNLOAD_TIMEOUT_SECONDS,
  SANDBOX_REPORT_PATH,
  SANDBOX_SCAN_TIMEOUT_SECONDS,
  SANDBOX_SETUP_TIMEOUT_SECONDS,
  SCAN_COMMAND,
  SETUP_TARGET_REPOSITORY_COMMAND,
} from "./constants.js";
import type {
  CorpusEvaluationRecord,
  CorpusRepository,
  CorpusRepositoryGroup,
  EvaluationProvenance,
} from "./corpus.js";
import { executeSandboxCommand } from "./execute-sandbox-command.js";
import {
  EvaluationDeadlineExceededError,
  getEvaluationTimeoutSeconds,
} from "./utils/get-evaluation-timeout-seconds.js";
import { parseReactDoctorReport } from "./utils/parse-react-doctor-report.js";
import { parseReactDoctorEvaluationProvenance } from "./utils/parse-react-doctor-evaluation-provenance.js";
import { toErrorMessage } from "./utils/to-error-message.js";

export interface EvaluateRepositoryBatchInput {
  daytona: Daytona;
  createSandbox: (sandboxName: string, deadlineMilliseconds: number) => Promise<Sandbox>;
  repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>;
  evaluationDeadlineMilliseconds: number;
  evaluatorSourceHash: string;
  onRecord: (record: CorpusEvaluationRecord) => Promise<void>;
}

interface EvaluateRepositoryGroupInput {
  sandbox: Sandbox;
  repositoryGroup: CorpusRepositoryGroup;
  evaluationProvenance: EvaluationProvenance;
  evaluationDeadlineMilliseconds: number;
  onRecord: (record: CorpusEvaluationRecord) => Promise<void>;
}

const buildRepositories = (
  repositoryGroup: CorpusRepositoryGroup,
): ReadonlyArray<CorpusRepository> =>
  repositoryGroup.rootDirectories.map((rootDirectory) => ({
    org: repositoryGroup.org,
    name: repositoryGroup.name,
    ref: repositoryGroup.ref,
    rootDir: rootDirectory,
  }));

const buildFailureRecords = (
  repositories: ReadonlyArray<CorpusRepository>,
  error: unknown,
): ReadonlyArray<CorpusEvaluationRecord> => {
  const errorMessage = toErrorMessage(error);
  return repositories.map((repository) => ({
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    repository,
    error: errorMessage,
  }));
};

const evaluateRepositoryGroup = async ({
  sandbox,
  repositoryGroup,
  evaluationProvenance,
  evaluationDeadlineMilliseconds,
  onRecord,
}: EvaluateRepositoryGroupInput): Promise<ReadonlyArray<CorpusEvaluationRecord>> => {
  let repositories = buildRepositories(repositoryGroup);
  try {
    const repositoryUrl = `https://github.com/${repositoryGroup.org}/${repositoryGroup.name}.git`;
    await executeSandboxCommand({
      sandbox,
      command: SETUP_TARGET_REPOSITORY_COMMAND,
      environment: {
        TARGET_REPOSITORY: repositoryUrl,
        TARGET_REF: repositoryGroup.ref,
      },
      timeoutSeconds: getEvaluationTimeoutSeconds({
        deadlineMilliseconds: evaluationDeadlineMilliseconds,
        maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
      }),
      description: `Clone ${repositoryGroup.org}/${repositoryGroup.name}`,
    });
    const resolvedRef = (
      await executeSandboxCommand({
        sandbox,
        command: RESOLVE_TARGET_REPOSITORY_REF_COMMAND,
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
    return buildFailureRecords(repositories, error);
  }

  const failedRecords: CorpusEvaluationRecord[] = [];
  for (const repository of repositories) {
    try {
      const commandResult = await executeSandboxCommand({
        sandbox,
        command: SCAN_COMMAND,
        environment: {
          TARGET_ROOT_DIRECTORY: repository.rootDir,
          SENTRY_DSN: "",
          SENTRY_TRACES_SAMPLE_RATE: "0",
        },
        timeoutSeconds: getEvaluationTimeoutSeconds({
          deadlineMilliseconds: evaluationDeadlineMilliseconds,
          maximumTimeoutSeconds: SANDBOX_SCAN_TIMEOUT_SECONDS,
        }),
        description: `Scan ${repository.org}/${repository.name}:${repository.rootDir}`,
        acceptNonZeroExitCode: true,
      });
      const reportContents = await sandbox.fs.downloadFile(
        SANDBOX_REPORT_PATH,
        getEvaluationTimeoutSeconds({
          deadlineMilliseconds: evaluationDeadlineMilliseconds,
          maximumTimeoutSeconds: SANDBOX_REPORT_DOWNLOAD_TIMEOUT_SECONDS,
        }),
      );
      const report = parseReactDoctorReport(
        reportContents.toString("utf8"),
        commandResult.exitCode,
      );
      await onRecord({
        schemaVersion: EVALUATION_SCHEMA_VERSION,
        repository,
        evaluation: evaluationProvenance,
        report,
      });
    } catch (error) {
      failedRecords.push(...buildFailureRecords([repository], error));
    }
  }
  return failedRecords;
};

export const evaluateRepositoryBatch = async ({
  daytona,
  createSandbox,
  repositoryGroups,
  evaluationDeadlineMilliseconds,
  evaluatorSourceHash,
  onRecord,
}: EvaluateRepositoryBatchInput): Promise<ReadonlyArray<CorpusEvaluationRecord>> => {
  const sandboxName = `${DAYTONA_RUN_NAME}-${randomUUID()}`;
  let sandbox: Sandbox | undefined;
  let shouldRecoverSandbox = true;
  try {
    try {
      sandbox = await createSandbox(sandboxName, evaluationDeadlineMilliseconds);
    } catch (error) {
      shouldRecoverSandbox = !(error instanceof EvaluationDeadlineExceededError);
      return repositoryGroups.flatMap((repositoryGroup) =>
        buildFailureRecords(buildRepositories(repositoryGroup), error),
      );
    }

    let evaluationProvenance: EvaluationProvenance;
    try {
      const provenanceContents = await sandbox.fs.downloadFile(
        REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
        getEvaluationTimeoutSeconds({
          deadlineMilliseconds: evaluationDeadlineMilliseconds,
          maximumTimeoutSeconds: SANDBOX_REPORT_DOWNLOAD_TIMEOUT_SECONDS,
        }),
      );
      evaluationProvenance = {
        ...parseReactDoctorEvaluationProvenance(provenanceContents.toString("utf8")),
        evaluatorSourceHash,
      };
    } catch (error) {
      return repositoryGroups.flatMap((repositoryGroup) =>
        buildFailureRecords(buildRepositories(repositoryGroup), error),
      );
    }

    const failedRecords: CorpusEvaluationRecord[] = [];
    for (const repositoryGroup of repositoryGroups) {
      failedRecords.push(
        ...(await evaluateRepositoryGroup({
          sandbox,
          repositoryGroup,
          evaluationProvenance,
          evaluationDeadlineMilliseconds,
          onRecord,
        })),
      );
    }
    return failedRecords;
  } finally {
    let sandboxToDelete = sandbox;
    if (!sandboxToDelete && shouldRecoverSandbox) {
      try {
        sandboxToDelete = await daytona.get(sandboxName);
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
        await daytona.delete(sandboxToDelete, SANDBOX_DELETE_TIMEOUT_SECONDS);
      } catch (error) {
        process.stderr.write(
          `Failed to delete Daytona sandbox ${sandboxToDelete.id}: ${toErrorMessage(error)}\n`,
        );
      }
    }
  }
};
