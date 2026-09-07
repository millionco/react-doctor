import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isRecord } from "./git-hook-shared.js";

export interface RunCommandResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

// Call-signature interface so command-running helpers (e.g.
// `detectDefaultBranch`) can take an injectable runner in tests without
// spawning real `git` / `gh` processes. `timeoutMs` kills the child and
// reports failure once exceeded; omit it for commands that may legitimately
// run long (`git push`, `gh pr create`).
export interface CommandRunner {
  (
    command: string,
    args: ReadonlyArray<string>,
    cwd: string,
    timeoutMs?: number,
  ): Promise<RunCommandResult>;
}

const execFileAsync = promisify(execFile);

// Async (was `spawnSync`) so call chains never block Node's event loop. While
// it blocked, the `ora` spinner in `setUpGitHubActions` couldn't advance its
// frames and looked frozen through the slow network steps (`gh auth status`,
// `git fetch`, `git push`, `gh pr create`). Output is captured into pipes,
// not inherited, so nothing interleaves with the spinner. `execFile` rejects
// on a non-zero exit (and on ENOENT); both carry the captured stdout/stderr
// on the error object.
export const runCommand: CommandRunner = async (command, args, cwd, timeoutMs) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
    });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const stdout = isRecord(error) && typeof error.stdout === "string" ? error.stdout : "";
    const stderr = isRecord(error) && typeof error.stderr === "string" ? error.stderr : "";
    return {
      success: false,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  }
};
