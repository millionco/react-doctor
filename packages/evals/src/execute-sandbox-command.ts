import type { Sandbox } from "@vercel/sandbox";

import { SUCCESS_EXIT_CODE, MILLISECONDS_PER_SECOND } from "./constants.js";

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
  const response = await sandbox.runCommand({
    cmd: "timeout",
    args: ["--signal=KILL", `${timeoutSeconds}s`, "bash", "-c", command],
    env: environment,
    signal: AbortSignal.timeout(timeoutSeconds * MILLISECONDS_PER_SECOND),
  });
  const [stdout, stderr] = await Promise.all([response.stdout(), response.stderr()]);
  const result = stdout + stderr;
  if (response.exitCode !== SUCCESS_EXIT_CODE && !acceptNonZeroExitCode) {
    const output = result.trim();
    throw new Error(
      output === "" ? `${description} failed with exit code ${response.exitCode}` : output,
    );
  }
  return { exitCode: response.exitCode, output: result };
};
