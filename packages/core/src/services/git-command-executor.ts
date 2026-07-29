import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import {
  SPAWN_ARGS_MAX_LENGTH_CHARS,
  SPAWN_ARGS_MAX_LENGTH_CHARS_DARWIN,
  SPAWN_ARGS_MAX_LENGTH_CHARS_POSIX,
} from "../constants.js";
import { GitInvocationFailed, ReactDoctorError } from "../errors.js";
import { isDirectory } from "../project-info/fs-utils.js";

export interface GitCommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitCommandInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly directory: string;
  readonly env?: Record<string, string | undefined>;
  /**
   * Hard cap on stdout bytes. When set, the command fails with a
   * `GitInvocationFailed` once the streamed output crosses the budget
   * instead of buffering the whole payload into memory.
   */
  readonly maxStdoutBytes?: number;
}

export interface GitCommandExecutor {
  (input: GitCommandInput): Effect.Effect<GitCommandResult, ReactDoctorError>;
}

// The Windows cap would reject legitimately long `--scope lines` diffs
// (`git diff -- <hundreds of files>`) that other platforms handle fine,
// silently degrading the scope — so the guard is platform-sized. Darwin gets
// its own cap because macOS ARG_MAX sits below the Linux one (rationale on
// each constant).
const resolveSpawnArgsLengthCap = (): number => {
  if (process.platform === "win32") return SPAWN_ARGS_MAX_LENGTH_CHARS;
  if (process.platform === "darwin") return SPAWN_ARGS_MAX_LENGTH_CHARS_DARWIN;
  return SPAWN_ARGS_MAX_LENGTH_CHARS_POSIX;
};

export const makeGitCommandExecutor = (
  spawner: ChildProcessSpawner["Service"],
): GitCommandExecutor => {
  const runCommand: GitCommandExecutor = (input) => {
    // Shared by the async `PlatformError` path and the synchronous-spawn
    // defect path so both spawn-failure shapes resolve identically: a
    // non-`git` command degrades to a non-zero result the caller already
    // handles; `git` fails with the tagged `GitInvocationFailed` its
    // degradation paths recover from.
    const foldSpawnFailure = (cause: unknown): Effect.Effect<GitCommandResult, ReactDoctorError> =>
      input.command !== "git"
        ? Effect.succeed({ status: 127, stdout: "", stderr: String(cause) })
        : Effect.fail(
            new ReactDoctorError({
              reason: new GitInvocationFailed({
                args: [...input.args],
                directory: input.directory,
                cause,
              }),
            }),
          );

    return Effect.scoped(
      Effect.gen(function* () {
        // `child_process.spawn` throws synchronously when the cwd isn't a
        // directory or argv exceeds the OS limit, bypassing Effect's failure
        // channel. Guard both predictable cases before spawning.
        if (!isDirectory(input.directory)) {
          return yield* foldSpawnFailure(
            `spawn ENOTDIR (cwd is not a directory: ${input.directory})`,
          );
        }
        const argvLengthChars =
          input.command.length +
          1 +
          input.args.reduce((total, argument) => total + argument.length + 1, 0);
        const spawnArgsLengthCap = resolveSpawnArgsLengthCap();
        if (argvLengthChars > spawnArgsLengthCap) {
          return yield* foldSpawnFailure(
            `spawn ENAMETOOLONG (${argvLengthChars} argv chars exceed ${spawnArgsLengthCap})`,
          );
        }
        const handle = yield* spawner.spawn(
          // HACK: `extendEnv: true` is required for spawned commands
          // to inherit `process.env.PATH` — without it Effect's
          // `ChildProcess` defaults to an empty env and `spawn`
          // immediately fails with `ENOENT` even when the binary is
          // on the user's PATH. (`spawnSync` inherited PATH by
          // default; ChildProcess's option flips the polarity.)
          ChildProcess.make(input.command, [...input.args], {
            cwd: input.directory,
            env: input.env,
            extendEnv: true,
          }),
        );
        // Count raw stdout bytes as they stream and fail before buffering an
        // oversized staged blob or grep result in memory.
        const maxStdoutBytes = input.maxStdoutBytes;
        const stdoutByteCount = yield* Ref.make(0);
        const stdoutStream =
          maxStdoutBytes === undefined
            ? handle.stdout
            : handle.stdout.pipe(
                Stream.tap((chunk) =>
                  Ref.updateAndGet(stdoutByteCount, (total) => total + chunk.length).pipe(
                    Effect.flatMap((total) =>
                      total > maxStdoutBytes
                        ? Effect.fail(
                            new ReactDoctorError({
                              reason: new GitInvocationFailed({
                                args: [...input.args],
                                directory: input.directory,
                                cause: new Error(`git stdout exceeded ${maxStdoutBytes} bytes`),
                              }),
                            }),
                          )
                        : Effect.void,
                    ),
                  ),
                ),
              );
        const [stdout, stderr, status] = yield* Effect.all(
          [
            Stream.mkString(Stream.decodeText(stdoutStream)),
            Stream.mkString(Stream.decodeText(handle.stderr)),
            handle.exitCode,
          ],
          { concurrency: 3 },
        );
        return { status, stdout, stderr } satisfies GitCommandResult;
      }),
    ).pipe(
      Effect.catchTag("PlatformError", foldSpawnFailure),
      // Full args can contain scanned paths, so traces record only the
      // command and first subcommand.
      Effect.withSpan("git.exec", {
        attributes: {
          "git.command": input.command,
          "git.subcommand": input.args[0] ?? "",
        },
      }),
    );
  };

  return runCommand;
};
