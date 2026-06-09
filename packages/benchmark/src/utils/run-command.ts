import { spawnSync } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  // True when the binary could not be spawned at all (ENOENT, permissions).
  spawnFailed: boolean;
}

// Run a command to completion, capturing output. Never throws and never treats
// a non-zero exit as an error — many tools the verifier drives (React Doctor,
// tsc) exit non-zero precisely when they have findings, which is the signal we
// want, not a failure. Callers inspect `spawnFailed` to distinguish a tool
// that ran-and-complained from one that never started.
export const runCommand = (
  command: string,
  args: string[],
  options: { cwd: string; maxBufferBytes?: number; timeoutMs?: number } = { cwd: process.cwd() },
): CommandResult => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: options.maxBufferBytes ?? 64 * 1024 * 1024,
    timeout: options.timeoutMs,
  });

  if (result.error) {
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? String(result.error),
      exitCode: typeof result.status === "number" ? result.status : 1,
      spawnFailed: true,
    };
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: typeof result.status === "number" ? result.status : 1,
    spawnFailed: false,
  };
};
