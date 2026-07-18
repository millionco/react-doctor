import type { Sandbox } from "@daytona/sdk";

export interface ExecuteSandboxCommandInput {
  sandbox: Sandbox;
  command: string;
  environment: Record<string, string>;
  timeoutSeconds: number;
  description: string;
}

export const executeSandboxCommand = async ({
  sandbox,
  command,
  environment,
  timeoutSeconds,
  description,
}: ExecuteSandboxCommandInput): Promise<string> => {
  const response = await sandbox.process.executeCommand(
    command,
    undefined,
    environment,
    timeoutSeconds,
  );
  if (response.exitCode !== 0) {
    const output = response.result.trim();
    throw new Error(
      output === "" ? `${description} failed with exit code ${response.exitCode}` : output,
    );
  }
  return response.result;
};
