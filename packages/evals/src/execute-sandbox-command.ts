import type { Sandbox } from "@daytona/sdk";

import { SUCCESS_EXIT_CODE } from "./constants.js";

export interface ExecuteSandboxCommandInput {
  sandbox: Sandbox;
  command: string;
  environment: Record<string, string>;
  timeoutSeconds: number;
  description: string;
  acceptNonZeroExitCode?: boolean;
}

export interface ExecuteSandboxCommandResult {
  exitCode: number;
  output: string;
}

export const executeSandboxCommand = async ({
  sandbox,
  command,
  environment,
  timeoutSeconds,
  description,
  acceptNonZeroExitCode = false,
}: ExecuteSandboxCommandInput): Promise<ExecuteSandboxCommandResult> => {
  const response = await sandbox.process.executeCommand(
    command,
    undefined,
    environment,
    timeoutSeconds,
  );
  if (response.exitCode !== SUCCESS_EXIT_CODE && !acceptNonZeroExitCode) {
    const output = response.result.trim();
    throw new Error(
      output === "" ? `${description} failed with exit code ${response.exitCode}` : output,
    );
  }
  return { exitCode: response.exitCode, output: response.result };
};
