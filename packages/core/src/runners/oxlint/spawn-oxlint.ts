import { spawn } from "node:child_process";
import {
  MILLISECONDS_PER_SECOND,
  OXLINT_OUTPUT_MAX_BYTES,
  OXLINT_SPAWN_TIMEOUT_MS as DEFAULT_OXLINT_SPAWN_TIMEOUT_MS,
} from "../../constants.js";
import { OxlintBatchExceeded, OxlintSpawnFailed, ReactDoctorError } from "../../errors.js";
import { buildOxlintChildEnv } from "../../utils/build-oxlint-child-env.js";
import { buildOxlintExitError } from "../../utils/build-oxlint-exit-error.js";
import { buildProfiledNodeArguments } from "../../utils/build-profiled-node-arguments.js";
import { captureOxlintRuleTimings } from "../../utils/capture-oxlint-rule-timings.js";
import { lowerChildProcessPriority } from "../../utils/lower-child-process-priority.js";
import {
  isOxlintJobTimelineEnabled,
  previewOxlintStdout,
  recordOxlintJobTimeline,
} from "../../utils/record-oxlint-job-timeline.js";

const SANITIZED_ENV: NodeJS.ProcessEnv = buildOxlintChildEnv(process.env);

/**
 * Spawn one oxlint subprocess with hard ceilings on wall time and
 * output size. Returns stdout on success; raises a tagged
 * `ReactDoctorError` for every documented failure mode:
 *
 * - `OxlintBatchExceeded { kind: "timeout" }` — wall budget elapsed.
 * - `OxlintBatchExceeded { kind: "output-too-large" }` — stdout+stderr
 *   crossed `OXLINT_OUTPUT_MAX_BYTES`.
 * - `OxlintBatchExceeded { kind: "oom" | "killed" }` — child exited
 *   on a signal (SIGABRT → OOM, others → generic kill), or with one
 *   of the abort exit codes Windows reports instead of a signal
 *   (`ABORT_EXIT_CODES` → OOM).
 * - `OxlintSpawnFailed { cause }` — `spawn` itself errored, or the
 *   child exited successfully but printed only stderr.
 *
 * The first three are splittable (the caller's binary-split retry
 * shrinks the batch and re-spawns); the fourth isn't.
 */
export const spawnOxlint = (
  args: string[],
  rootDirectory: string,
  nodeBinaryPath: string,
  // Defaults preserve standalone behavior; the orchestrated path
  // (Linter → runOxlint → spawnLintBatches) threads these from the
  // `OxlintSpawnTimeoutMs` / `OxlintOutputMaxBytes` Context.References,
  // so the eval harness can override them via `Layer.succeed`.
  spawnTimeoutMs: number = DEFAULT_OXLINT_SPAWN_TIMEOUT_MS,
  outputMaxBytes: number = OXLINT_OUTPUT_MAX_BYTES,
  // Aborted when the orchestrator's lint-phase timeout fires. Reclaims the
  // in-flight oxlint child (and short-circuits one not yet spawned) so the
  // bounded lint phase actually stops work instead of leaving subprocesses
  // running until their own per-batch spawn timeout.
  abortSignal?: AbortSignal,
  onSpawn?: () => void,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(
        new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause: "lint phase aborted" }) }),
      );
      return;
    }
    onSpawn?.();
    const child = spawn(
      nodeBinaryPath,
      buildProfiledNodeArguments({
        argumentsList: args,
        cpuProfileDirectory: SANITIZED_ENV.REACT_DOCTOR_CPU_PROFILE_DIR,
        heapProfileDirectory: SANITIZED_ENV.REACT_DOCTOR_HEAP_PROFILE_DIR,
      }),
      {
        cwd: rootDirectory,
        env: SANITIZED_ENV,
        // HACK: oxlint's cli.js sets process.stdin._handle.setBlocking(true)
        // when stdout is not a TTY. This initializes and refs the child's stdin
        // handle, and since the parent never closes the pipe the child's event
        // loop can't drain after the lint operation — hanging the process
        // indefinitely (observed on WSL 2, Node v24). Connecting stdin to
        // /dev/null makes the setBlocking call harmless and lets the child exit
        // cleanly once the lint pass finishes.
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    lowerChildProcessPriority(child.pid);
    const spawnedAt = Date.now();

    const onAbort = () => {
      child.kill("SIGKILL");
      reject(
        new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause: "lint phase aborted" }) }),
      );
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    // The signal is shared across every batch's spawn in one lint run, so
    // each settle path must drop its listener or they accumulate.
    const clearAbortListener = () => abortSignal?.removeEventListener("abort", onAbort);

    const timeoutHandle = setTimeout(() => {
      clearAbortListener();
      child.kill("SIGKILL");
      reject(
        new ReactDoctorError({
          reason: new OxlintBatchExceeded({
            kind: "timeout",
            detail: `${spawnTimeoutMs / MILLISECONDS_PER_SECOND}s budget exceeded`,
          }),
        }),
      );
    }, spawnTimeoutMs);
    timeoutHandle.unref?.();

    const stdoutBuffers: Buffer[] = [];
    const stderrBuffers: Buffer[] = [];
    let stdoutByteCount = 0;
    let stderrByteCount = 0;
    let didKillForSize = false;

    const killIfTooLarge = (incomingBytes: number, isStdout: boolean): boolean => {
      if (isStdout) {
        stdoutByteCount += incomingBytes;
      } else {
        stderrByteCount += incomingBytes;
      }
      if (stdoutByteCount + stderrByteCount > outputMaxBytes && !didKillForSize) {
        didKillForSize = true;
        child.kill("SIGKILL");
        return true;
      }
      return false;
    };

    child.stdout.on("data", (buffer: Buffer) => {
      if (didKillForSize) return;
      stdoutBuffers.push(buffer);
      killIfTooLarge(buffer.length, true);
    });
    child.stderr.on("data", (buffer: Buffer) => {
      if (didKillForSize) return;
      stderrBuffers.push(buffer);
      killIfTooLarge(buffer.length, false);
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      clearAbortListener();
      reject(new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause: error }) }));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeoutHandle);
      clearAbortListener();
      if (isOxlintJobTimelineEnabled) {
        recordOxlintJobTimeline({
          pid: child.pid ?? null,
          startedAt: spawnedAt,
          endedAt: Date.now(),
          args,
          exitCode: code,
          signal,
          stdoutBytes: stdoutByteCount,
          stderrBytes: stderrByteCount,
          stdoutPreview: previewOxlintStdout(Buffer.concat(stdoutBuffers)),
        });
      }
      if (didKillForSize) {
        reject(
          new ReactDoctorError({
            reason: new OxlintBatchExceeded({
              kind: "output-too-large",
              detail: `exceeded ${outputMaxBytes} bytes — scan a smaller subset with --diff or --staged`,
            }),
          }),
        );
        return;
      }
      const exitError = buildOxlintExitError({
        exitCode: code,
        signal,
        stderrOutput: Buffer.concat(stderrBuffers).toString("utf-8").trim(),
      });
      if (exitError !== null) {
        reject(exitError);
        return;
      }
      const output = Buffer.concat(stdoutBuffers).toString("utf-8").trim();
      if (!output) {
        const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
        if (stderrOutput) {
          reject(new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause: stderrOutput }) }));
          return;
        }
      }
      const timingDirectory = SANITIZED_ENV.REACT_DOCTOR_OXLINT_TIMINGS_DIR;
      if (timingDirectory === undefined) {
        resolve(output);
        return;
      }
      captureOxlintRuleTimings({
        argumentsList: args,
        environment: SANITIZED_ENV,
        nodeBinaryPath,
        rootDirectory,
        timingDirectory,
      }).then(() => resolve(output), reject);
    });
  });
