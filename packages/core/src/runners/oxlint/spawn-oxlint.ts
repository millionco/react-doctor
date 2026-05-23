import { spawn } from "node:child_process";
import {
  OXLINT_OUTPUT_MAX_BYTES,
  OXLINT_SPAWN_TIMEOUT_MS as DEFAULT_OXLINT_SPAWN_TIMEOUT_MS,
} from "../../constants.js";
import { OxlintBatchExceeded, OxlintSpawnFailed, ReactDoctorError } from "../../errors.js";

// HACK: Sanitize child env so a developer's NODE_OPTIONS=--inspect (or
// --max-old-space-size=128, etc.) doesn't leak into oxlint and either spawn a
// debugger port or starve it of memory. We also drop npm_config_* lifecycle
// vars to keep oxlint from picking up package-manager state. PATH, HOME,
// NODE_ENV, NODE_PATH, etc. pass through unchanged.
const SANITIZED_ENV: NodeJS.ProcessEnv = (() => {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name === "NODE_OPTIONS" || name === "NODE_DEBUG") continue;
    if (name.startsWith("npm_config_")) continue;
    sanitized[name] = value;
  }
  return sanitized;
})();

// HACK: env override (`REACT_DOCTOR_OXLINT_SPAWN_TIMEOUT_MS`) so the
// evals harness can raise the per-batch budget when running under
// Vercel Sandbox microVMs, where the oxlint native binding is markedly
// slower than on a developer laptop and the default starves every
// batch. The default (and the docstring naming the regression that
// pinned it) lives in constants.ts.
const OXLINT_SPAWN_TIMEOUT_MS = (() => {
  const raw = process.env["REACT_DOCTOR_OXLINT_SPAWN_TIMEOUT_MS"];
  if (raw === undefined) return DEFAULT_OXLINT_SPAWN_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_OXLINT_SPAWN_TIMEOUT_MS;
  return parsed;
})();

/**
 * Spawn one oxlint subprocess with hard ceilings on wall time and
 * output size. Returns stdout on success; raises a tagged
 * `ReactDoctorError` for every documented failure mode:
 *
 * - `OxlintBatchExceeded { kind: "timeout" }` — wall budget elapsed.
 * - `OxlintBatchExceeded { kind: "output-too-large" }` — stdout+stderr
 *   crossed `OXLINT_OUTPUT_MAX_BYTES`.
 * - `OxlintBatchExceeded { kind: "oom" | "killed" }` — child exited
 *   on a signal (SIGABRT → OOM, others → generic kill).
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
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(nodeBinaryPath, args, {
      cwd: rootDirectory,
      env: SANITIZED_ENV,
    });

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new ReactDoctorError({
          reason: new OxlintBatchExceeded({
            kind: "timeout",
            detail: `${OXLINT_SPAWN_TIMEOUT_MS / 1000}s budget exceeded`,
          }),
        }),
      );
    }, OXLINT_SPAWN_TIMEOUT_MS);
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
      if (stdoutByteCount + stderrByteCount > OXLINT_OUTPUT_MAX_BYTES && !didKillForSize) {
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
      reject(new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause: error }) }));
    });
    child.on("close", (_code, signal) => {
      clearTimeout(timeoutHandle);
      if (didKillForSize) {
        reject(
          new ReactDoctorError({
            reason: new OxlintBatchExceeded({
              kind: "output-too-large",
              detail: `exceeded ${OXLINT_OUTPUT_MAX_BYTES} bytes — scan a smaller subset with --diff or --staged`,
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
