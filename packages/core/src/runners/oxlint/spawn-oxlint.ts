import { spawn } from "node:child_process";
import {
  MILLISECONDS_PER_SECOND,
  OXLINT_OUTPUT_MAX_BYTES,
  OXLINT_SPAWN_TIMEOUT_MS as DEFAULT_OXLINT_SPAWN_TIMEOUT_MS,
} from "../../constants.js";
import { OxlintBatchExceeded, OxlintSpawnFailed, ReactDoctorError } from "../../errors.js";
import { buildOxlintChildEnv } from "../../utils/build-oxlint-child-env.js";

export const spawnOxlint = (
  args: string[],
  rootDirectory: string,
  nodeBinaryPath: string,
  spawnTimeoutMs: number = DEFAULT_OXLINT_SPAWN_TIMEOUT_MS,
  outputMaxBytes: number = OXLINT_OUTPUT_MAX_BYTES,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(nodeBinaryPath, args, {
      cwd: rootDirectory,
      env: buildOxlintChildEnv(process.env),
      // HACK: oxlint's cli.js sets process.stdin._handle.setBlocking(true)
      // when stdout is not a TTY. This initializes and refs the child's stdin
      // handle, and since the parent never closes the pipe the child's event
      // loop can't drain after the lint operation — hanging the process
      // indefinitely (observed on WSL 2, Node v24). Connecting stdin to
      // /dev/null makes the setBlocking call harmless and lets the child exit
      // cleanly once the lint pass finishes.
      stdio: ["ignore", "pipe", "pipe"],
    });

    let didSettle = false;
    const settle = (callback: () => void): void => {
      if (didSettle) return;
      didSettle = true;
      callback();
    };

    const timeoutHandle = setTimeout(() => {
      settle(() => {
        child.kill("SIGKILL");
        reject(
          new ReactDoctorError({
            reason: new OxlintBatchExceeded({
              kind: "timeout",
              detail: `${spawnTimeoutMs / MILLISECONDS_PER_SECOND}s budget exceeded`,
            }),
          }),
        );
      });
    }, spawnTimeoutMs);
    timeoutHandle.unref?.();

    const stdoutBuffers: Buffer[] = [];
    const stderrBuffers: Buffer[] = [];
    let totalByteCount = 0;
    let didKillForSize = false;

    const collectOutput = (buffers: Buffer[], buffer: Buffer): void => {
      if (didKillForSize) return;
      totalByteCount += buffer.length;
      if (totalByteCount > outputMaxBytes) {
        didKillForSize = true;
        child.kill("SIGKILL");
        return;
      }
      buffers.push(buffer);
    };

    child.stdout.on("data", (buffer: Buffer) => {
      collectOutput(stdoutBuffers, buffer);
    });
    child.stderr.on("data", (buffer: Buffer) => {
      collectOutput(stderrBuffers, buffer);
    });

    child.on("error", (error) => {
      settle(() => {
        clearTimeout(timeoutHandle);
        reject(new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause: error }) }));
      });
    });
    child.on("close", (_code, signal) => {
      settle(() => {
        clearTimeout(timeoutHandle);
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
        if (signal) {
          const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
          const isOom = signal === "SIGABRT";
          const detailParts: string[] = [`killed by ${signal}`];
          if (isOom) detailParts.push("try scanning fewer files with --diff");
          if (stderrOutput) detailParts.push(stderrOutput);
          reject(
            new ReactDoctorError({
              reason: new OxlintBatchExceeded({
                kind: isOom ? "oom" : "killed",
                detail: detailParts.join(" — "),
              }),
            }),
          );
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
        resolve(output);
      });
    });
  });
