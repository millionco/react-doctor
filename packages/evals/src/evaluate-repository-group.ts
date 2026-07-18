import type { Daytona, Sandbox } from "@daytona/sdk";

import {
  EVALUATION_SCHEMA_VERSION,
  SANDBOX_DELETE_TIMEOUT_SECONDS,
  SANDBOX_FORK_TIMEOUT_SECONDS,
  SANDBOX_SCAN_TIMEOUT_SECONDS,
  SANDBOX_SETUP_TIMEOUT_SECONDS,
  SCAN_COMMAND,
  SETUP_TARGET_REPOSITORY_COMMAND,
} from "./constants.js";
import type { CorpusEvaluationRecord, CorpusRepositoryGroup } from "./corpus.js";
import { executeSandboxCommand } from "./execute-sandbox-command.js";
import { toErrorMessage } from "./utils/to-error-message.js";

export interface EvaluateRepositoryGroupInput {
  daytona: Daytona;
  seedSandbox: Sandbox;
  repositoryGroup: CorpusRepositoryGroup;
  onRecord: (record: CorpusEvaluationRecord) => Promise<void>;
}

export const evaluateRepositoryGroup = async ({
  daytona,
  seedSandbox,
  repositoryGroup,
  onRecord,
}: EvaluateRepositoryGroupInput): Promise<void> => {
  const repositories = repositoryGroup.rootDirectories.map((rootDirectory) => ({
    org: repositoryGroup.org,
    name: repositoryGroup.name,
    ref: repositoryGroup.ref,
    rootDir: rootDirectory,
  }));
  let sandbox: Sandbox | undefined;
  try {
    sandbox = await daytona._experimental_fork(
      seedSandbox,
      undefined,
      SANDBOX_FORK_TIMEOUT_SECONDS,
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

    for (const repository of repositories) {
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
        });
        const report: unknown = JSON.parse(output);
        await onRecord({
          schemaVersion: EVALUATION_SCHEMA_VERSION,
          repository,
          report,
        });
      } catch (error) {
        await onRecord({
          schemaVersion: EVALUATION_SCHEMA_VERSION,
          repository,
          error: toErrorMessage(error),
        });
      }
    }
  } catch (error) {
    for (const repository of repositories) {
      await onRecord({
        schemaVersion: EVALUATION_SCHEMA_VERSION,
        repository,
        error: toErrorMessage(error),
      });
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
