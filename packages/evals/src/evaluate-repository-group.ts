import { randomUUID } from "node:crypto";

import { DaytonaNotFoundError } from "@daytona/sdk";
import type { Daytona, Sandbox } from "@daytona/sdk";

import {
  EVALUATION_SCHEMA_VERSION,
  RESOLVE_TARGET_REPOSITORY_REF_COMMAND,
  SANDBOX_DELETE_TIMEOUT_SECONDS,
  SANDBOX_SCAN_TIMEOUT_SECONDS,
  SANDBOX_SETUP_TIMEOUT_SECONDS,
  SCAN_COMMAND,
  SETUP_TARGET_REPOSITORY_COMMAND,
} from "./constants.js";
import type { CorpusEvaluationRecord, CorpusRepositoryGroup } from "./corpus.js";
import { executeSandboxCommand } from "./execute-sandbox-command.js";
import { parseReactDoctorReport } from "./utils/parse-react-doctor-report.js";
import { toErrorMessage } from "./utils/to-error-message.js";

export interface EvaluateRepositoryGroupInput {
  daytona: Daytona;
  createSandbox: (sandboxName: string) => Promise<Sandbox>;
  repositoryGroup: CorpusRepositoryGroup;
  onRecord: (record: CorpusEvaluationRecord) => Promise<void>;
}

export const evaluateRepositoryGroup = async ({
  daytona,
  createSandbox,
  repositoryGroup,
  onRecord,
}: EvaluateRepositoryGroupInput): Promise<ReadonlyArray<CorpusEvaluationRecord>> => {
  let repositories = repositoryGroup.rootDirectories.map((rootDirectory) => ({
    org: repositoryGroup.org,
    name: repositoryGroup.name,
    ref: repositoryGroup.ref,
    rootDir: rootDirectory,
  }));
  const sandboxName = `react-doctor-eval-${randomUUID()}`;
  let sandbox: Sandbox | undefined;
  try {
    try {
      sandbox = await createSandbox(sandboxName);
      const repositoryUrl = `https://github.com/${repositoryGroup.org}/${repositoryGroup.name}.git`;
      await executeSandboxCommand({
        sandbox,
        command: SETUP_TARGET_REPOSITORY_COMMAND,
        environment: {
          TARGET_REPOSITORY: repositoryUrl,
          TARGET_REF: repositoryGroup.ref,
        },
        timeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
        description: `Clone ${repositoryGroup.org}/${repositoryGroup.name}`,
      });
      const resolvedRef = (
        await executeSandboxCommand({
          sandbox,
          command: RESOLVE_TARGET_REPOSITORY_REF_COMMAND,
          environment: {},
          timeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
          description: `Resolve ${repositoryGroup.org}/${repositoryGroup.name}`,
        })
      ).output.trim();
      repositories = repositories.map((repository) => ({ ...repository, ref: resolvedRef }));
    } catch (error) {
      return repositories.map((repository) => ({
        schemaVersion: EVALUATION_SCHEMA_VERSION,
        repository,
        error: toErrorMessage(error),
      }));
    }

    const failedRecords: CorpusEvaluationRecord[] = [];
    for (const repository of repositories) {
      let record: CorpusEvaluationRecord;
      try {
        const commandResult = await executeSandboxCommand({
          sandbox,
          command: SCAN_COMMAND,
          environment: {
            TARGET_ROOT_DIRECTORY: repository.rootDir,
            SENTRY_DSN: "",
            SENTRY_TRACES_SAMPLE_RATE: "0",
          },
          timeoutSeconds: SANDBOX_SCAN_TIMEOUT_SECONDS,
          description: `Scan ${repository.org}/${repository.name}:${repository.rootDir}`,
          acceptNonZeroExitCode: true,
        });
        const report = parseReactDoctorReport(commandResult.output, commandResult.exitCode);
        record = {
          schemaVersion: EVALUATION_SCHEMA_VERSION,
          repository,
          report,
        };
      } catch (error) {
        failedRecords.push({
          schemaVersion: EVALUATION_SCHEMA_VERSION,
          repository,
          error: toErrorMessage(error),
        });
        continue;
      }
      await onRecord(record);
    }
    return failedRecords;
  } finally {
    let sandboxToDelete = sandbox;
    if (!sandboxToDelete) {
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
