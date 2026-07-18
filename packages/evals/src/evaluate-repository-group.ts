import type { Daytona, Sandbox } from "@daytona/sdk";

import {
  EVALUATION_SCHEMA_VERSION,
  RESOLVE_TARGET_REPOSITORY_REF_COMMAND,
  SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
  SANDBOX_CREATE_TIMEOUT_SECONDS,
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
  evaluationId: string;
  snapshotName: string;
  repositoryGroup: CorpusRepositoryGroup;
  onRecord: (record: CorpusEvaluationRecord) => Promise<void>;
}

export const evaluateRepositoryGroup = async ({
  daytona,
  evaluationId,
  snapshotName,
  repositoryGroup,
  onRecord,
}: EvaluateRepositoryGroupInput): Promise<void> => {
  let repositories = repositoryGroup.rootDirectories.map((rootDirectory) => ({
    org: repositoryGroup.org,
    name: repositoryGroup.name,
    ref: repositoryGroup.ref,
    rootDir: rootDirectory,
  }));
  let sandbox: Sandbox | undefined;
  try {
    try {
      sandbox = await daytona.create(
        {
          snapshot: snapshotName,
          ephemeral: true,
          autoStopInterval: SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
          labels: {
            evaluation: evaluationId,
            project: "react-doctor",
            purpose: "eval-repository",
          },
        },
        { timeout: SANDBOX_CREATE_TIMEOUT_SECONDS },
      );
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
      ).trim();
      repositories = repositories.map((repository) => ({ ...repository, ref: resolvedRef }));
    } catch (error) {
      for (const repository of repositories) {
        await onRecord({
          schemaVersion: EVALUATION_SCHEMA_VERSION,
          repository,
          error: toErrorMessage(error),
        });
      }
      return;
    }

    for (const repository of repositories) {
      let record: CorpusEvaluationRecord;
      try {
        const output = await executeSandboxCommand({
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
        const report = parseReactDoctorReport(output);
        record = {
          schemaVersion: EVALUATION_SCHEMA_VERSION,
          repository,
          report,
        };
      } catch (error) {
        record = {
          schemaVersion: EVALUATION_SCHEMA_VERSION,
          repository,
          error: toErrorMessage(error),
        };
      }
      await onRecord(record);
    }
  } finally {
    if (sandbox) {
      try {
        await daytona.delete(sandbox, SANDBOX_DELETE_TIMEOUT_SECONDS);
      } catch (error) {
        process.stderr.write(
          `Failed to delete Daytona sandbox ${sandbox.id}: ${toErrorMessage(error)}\n`,
        );
      }
    }
  }
};
