import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckSecurityScanOptions } from "../../check-security-scan.js";
import {
  SECURITY_SCAN_WORKER_KILL_TIMEOUT_MS,
  SECURITY_SCAN_WORKER_SHUTDOWN_GRACE_MS,
  SECURITY_SCAN_WORKER_STARTUP_TIMEOUT_MS,
} from "../../constants.js";
import type { Diagnostic } from "../../types/index.js";
import { isRecord } from "../../utils/is-record.js";
import {
  encodeSecurityScanWorkerOptions,
  parseSecurityScanWorkerResult,
  type SecurityScanWorkerAbort,
  type SecurityScanWorkerOptions,
  type SecurityScanWorkerRequest,
} from "./security-scan-worker-protocol.js";

export interface SecurityScanWorker {
  readonly run: (
    rootDirectory: string,
    options?: CheckSecurityScanOptions,
  ) => Promise<Diagnostic[]>;
  readonly dispose: () => Promise<void>;
}

interface CreateSecurityScanWorkerOptions {
  readonly createChild?: (workerPath: string, options: SpawnOptions) => ChildProcess;
}

interface SecurityScanWorkerJob {
  readonly id: number;
  readonly rootDirectory: string;
  readonly options: CheckSecurityScanOptions;
  readonly encodedOptions: SecurityScanWorkerOptions;
  readonly resolve: (diagnostics: Diagnostic[]) => void;
  readonly reject: (error: unknown) => void;
  readonly onAbort: () => void;
  settled: boolean;
}

export const createSecurityScanWorker = (
  options: CreateSecurityScanWorkerOptions = {},
): SecurityScanWorker => {
  const environment = { ...process.env };
  const workingDirectory = process.cwd();
  const workerPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "security-scan-worker.js",
  );
  const queue: SecurityScanWorkerJob[] = [];
  let child: ChildProcess | null = null;
  let activeJob: SecurityScanWorkerJob | null = null;
  let nextId = 0;
  let ready = false;
  let closed = false;
  let disposed = false;
  let failure: Error | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let disposal: Promise<void> | undefined;
  const settle = (job: SecurityScanWorkerJob, complete: () => void): void => {
    if (job.settled) return;
    job.settled = true;
    job.options.signal?.removeEventListener("abort", job.onAbort);
    complete();
  };
  const killChild = (): void => {
    if (child === null || closed) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // HACK: Cleanup must not replace the scan's original failure.
    }
  };
  const dispose = (): Promise<void> => {
    if (disposal !== undefined) return disposal;
    disposed = true;
    clearTimeout(startupTimer);
    const error = failure ?? new Error("Security scan worker was disposed.");
    for (const job of queue.splice(0))
      settle(job, () =>
        job.reject(job.options.signal?.aborted ? job.options.signal.reason : error),
      );
    if (activeJob !== null) {
      const job = activeJob;
      settle(job, () =>
        job.reject(job.options.signal?.aborted ? job.options.signal.reason : error),
      );
    }
    const ownedChild = child;
    if (ownedChild === null || closed) {
      disposal = Promise.resolve();
      return disposal;
    }
    disposal = new Promise((resolve) => {
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        clearTimeout(graceTimer);
        clearTimeout(forceTimer);
        ownedChild.removeListener("close", finish);
        ownedChild.removeListener("exit", finish);
        try {
          ownedChild.unref();
          ownedChild.channel?.unref();
        } catch {
          // HACK: Cleanup remains non-throwing when the process already exited.
        }
        resolve();
      };
      const graceTimer = setTimeout(() => {
        forceTimer = setTimeout(finish, SECURITY_SCAN_WORKER_KILL_TIMEOUT_MS);
        killChild();
      }, SECURITY_SCAN_WORKER_SHUTDOWN_GRACE_MS);
      ownedChild.once("close", finish);
      ownedChild.once("exit", finish);
      try {
        if (ownedChild.connected) ownedChild.disconnect();
      } catch {
        killChild();
      }
    });
    return disposal;
  };
  const fail = (error: unknown): void => {
    if (failure !== null || disposed) return;
    failure = error instanceof Error ? error : new Error(String(error));
    void dispose();
  };
  const send = (message: SecurityScanWorkerRequest | SecurityScanWorkerAbort): void => {
    if (child === null || !child.connected) {
      fail(new Error("Security scan worker IPC disconnected."));
      return;
    }
    try {
      child.send(message, (error) => {
        if (error) fail(error);
      });
    } catch (error) {
      fail(error);
    }
  };
  const dispatch = (): void => {
    if (!ready || activeJob !== null || disposed) return;
    const job = queue.shift();
    if (job === undefined) return;
    if (job.options.signal?.aborted) {
      settle(job, () => job.reject(job.options.signal?.reason));
      dispatch();
      return;
    }
    activeJob = job;
    send({
      type: "scan",
      id: job.id,
      rootDirectory: job.rootDirectory,
      options: job.encodedOptions,
    });
  };
  const start = (): void => {
    if (child !== null) return;
    try {
      const spawnOptions: SpawnOptions = {
        cwd: workingDirectory,
        env: environment,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        serialization: "advanced",
        windowsHide: true,
      };
      child =
        options.createChild?.(workerPath, spawnOptions) ??
        spawn(process.execPath, [workerPath], spawnOptions);
      process.once("exit", killChild);
      const onExit = (): void => {
        if (closed) return;
        closed = true;
        clearTimeout(startupTimer);
        process.removeListener("exit", killChild);
        if (!disposed) fail(new Error("Security scan worker exited unexpectedly."));
      };
      child.once("close", onExit);
      child.once("exit", onExit);
      child.on("error", fail);
      child.on("disconnect", () => {
        if (!disposed) fail(new Error("Security scan worker disconnected unexpectedly."));
      });
      child.on("message", (value: unknown) => {
        if (disposed) return;
        try {
          if (isRecord(value) && value.type === "ready") {
            if (ready) throw new Error("Security scan worker initialized twice.");
            ready = true;
            clearTimeout(startupTimer);
            dispatch();
            return;
          }
          const result = parseSecurityScanWorkerResult(value);
          const job = activeJob;
          if (job === null || job.id !== result.id)
            throw new Error("Security scan worker returned an unexpected job.");
          activeJob = null;
          if (!job.settled) {
            try {
              job.options.signal?.throwIfAborted();
              if (result.didReachDeadline) job.options.onDeadlineExceeded?.();
              job.options.signal?.throwIfAborted();
              if (result.ok) settle(job, () => job.resolve(result.diagnostics));
              else {
                const error = new Error(result.error.message);
                error.name = result.error.name;
                if (result.error.stack !== undefined) error.stack = result.error.stack;
                settle(job, () => job.reject(error));
              }
            } catch (error) {
              settle(job, () => job.reject(error));
            }
          }
          dispatch();
        } catch (error) {
          fail(error);
        }
      });
      startupTimer = setTimeout(
        () => fail(new Error("Security scan worker initialization timed out.")),
        SECURITY_SCAN_WORKER_STARTUP_TIMEOUT_MS,
      );
      startupTimer.unref();
    } catch (error) {
      fail(error);
    }
  };
  return {
    run: async (rootDirectory, scanOptions = {}) => {
      scanOptions.signal?.throwIfAborted();
      if (failure !== null) throw failure;
      if (disposed) throw new Error("Security scan worker was disposed.");
      const encodedOptions = encodeSecurityScanWorkerOptions(scanOptions);
      return new Promise<Diagnostic[]>((resolve, reject) => {
        const job: SecurityScanWorkerJob = {
          id: ++nextId,
          rootDirectory,
          options: {
            signal: scanOptions.signal,
            onDeadlineExceeded: scanOptions.onDeadlineExceeded,
          },
          encodedOptions,
          resolve,
          reject,
          settled: false,
          onAbort: () => {
            settle(job, () => reject(job.options.signal?.reason));
            if (activeJob === job) send({ type: "abort", id: job.id });
            else {
              const index = queue.indexOf(job);
              if (index !== -1) queue.splice(index, 1);
            }
          },
        };
        queue.push(job);
        job.options.signal?.addEventListener("abort", job.onAbort, { once: true });
        start();
        dispatch();
      });
    },
    dispose,
  };
};
