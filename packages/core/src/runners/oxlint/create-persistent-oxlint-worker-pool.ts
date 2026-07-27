import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  ABORT_EXIT_CODES,
  MILLISECONDS_PER_SECOND,
  MIN_SCAN_CONCURRENCY,
  OXLINT_OUTPUT_MAX_BYTES,
  OXLINT_SPAWN_TIMEOUT_MS,
} from "../../constants.js";
import { OxlintBatchExceeded, OxlintSpawnFailed, ReactDoctorError } from "../../errors.js";
import { buildOxlintChildEnv } from "../../utils/build-oxlint-child-env.js";
import { createWorkerSlots } from "../../utils/create-worker-slots.js";
import type { OxlintBatchRunner, OxlintBatchRunnerInput } from "./spawn-oxlint.js";

interface PersistentOxlintWorkerRequest {
  readonly responseMarker: string;
  readonly args: ReadonlyArray<string>;
  readonly rootDirectory: string;
}

interface PersistentOxlintWorkerPoolInput {
  readonly workerCount: number;
  readonly nodeBinaryPath: string;
  readonly workerScriptPath: string;
  readonly maxRunsPerWorker?: number;
  readonly onWorkerSpawn?: (processId: number | undefined) => void;
}

interface PersistentOxlintWorkerPool extends OxlintBatchRunner {
  readonly close: () => Promise<void>;
}

interface PendingPersistentOxlintRequest {
  readonly resolve: (output: string) => void;
  readonly reject: (error: ReactDoctorError) => void;
  readonly responseMarker: Buffer;
  readonly outputMaxBytes: number;
  readonly abortSignal: AbortSignal | undefined;
  readonly onAbort: () => void;
  readonly timeoutHandle: NodeJS.Timeout;
  stdout: Buffer;
  stderr: Buffer;
}

interface PersistentOxlintWorker {
  readonly run: (input: OxlintBatchRunnerInput) => Promise<string>;
  readonly close: () => Promise<void>;
}

interface WorkerPoolEntry {
  worker: PersistentOxlintWorker | null;
  completedRunCount: number;
}

const SUCCESS_RESPONSE_SUFFIX = Buffer.from("\u0001\n");
const FAILURE_RESPONSE_SUFFIX = Buffer.from("\u0000\n");

const createSpawnFailedError = (cause: unknown): ReactDoctorError =>
  new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause }) });

const createOutputExceededError = (outputMaxBytes: number): ReactDoctorError =>
  new ReactDoctorError({
    reason: new OxlintBatchExceeded({
      kind: "output-too-large",
      detail: `exceeded ${outputMaxBytes} bytes — scan a smaller subset with --diff or --staged`,
    }),
  });

const createTerminatedError = (
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: Buffer,
): ReactDoctorError => {
  const isAbortExitCode = code !== null && ABORT_EXIT_CODES.has(code);
  if (!signal && !isAbortExitCode) {
    return createSpawnFailedError(
      stderr.toString("utf8").trim() || `persistent oxlint worker exited with code ${code}`,
    );
  }
  const isOom = signal === "SIGABRT" || isAbortExitCode;
  const detailParts = [signal ? `killed by ${signal}` : `aborted with exit code ${code}`];
  if (isOom) detailParts.push("try scanning fewer files with --diff");
  const stderrOutput = stderr.toString("utf8").trim();
  if (stderrOutput) detailParts.push(stderrOutput);
  return new ReactDoctorError({
    reason: new OxlintBatchExceeded({
      kind: isOom ? "oom" : "killed",
      detail: detailParts.join(" — "),
    }),
  });
};

const createPersistentOxlintWorker = (
  input: PersistentOxlintWorkerPoolInput,
): PersistentOxlintWorker => {
  const child = spawn(input.nodeBinaryPath, [input.workerScriptPath], {
    env: buildOxlintChildEnv(process.env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  input.onWorkerSpawn?.(child.pid);
  let pendingRequest: PendingPersistentOxlintRequest | null = null;
  let didClose = false;
  let resolveClose: () => void;
  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });

  const settlePendingRequest = (
    settle: (request: PendingPersistentOxlintRequest) => void,
  ): void => {
    const request = pendingRequest;
    if (request === null) return;
    pendingRequest = null;
    clearTimeout(request.timeoutHandle);
    request.abortSignal?.removeEventListener("abort", request.onAbort);
    settle(request);
  };

  const terminateForOutputLimit = (): void => {
    const request = pendingRequest;
    if (request === null) return;
    const markerAllowance = request.responseMarker.byteLength + SUCCESS_RESPONSE_SUFFIX.byteLength;
    if (
      request.stdout.byteLength + request.stderr.byteLength <=
      request.outputMaxBytes + markerAllowance
    ) {
      return;
    }
    child.kill("SIGKILL");
    settlePendingRequest((activeRequest) => {
      activeRequest.reject(createOutputExceededError(activeRequest.outputMaxBytes));
    });
  };

  child.stdout.on("data", (chunk: Buffer) => {
    const request = pendingRequest;
    if (request === null) return;
    request.stdout = Buffer.concat([request.stdout, chunk]);
    const markerIndex = request.stdout.indexOf(request.responseMarker);
    if (markerIndex === -1) {
      terminateForOutputLimit();
      return;
    }
    const statusIndex = markerIndex + request.responseMarker.byteLength;
    const responseEndIndex = statusIndex + SUCCESS_RESPONSE_SUFFIX.byteLength;
    if (request.stdout.byteLength < responseEndIndex) return;
    const output = request.stdout.subarray(0, markerIndex);
    const responseSuffix = request.stdout.subarray(statusIndex, responseEndIndex);
    if (output.byteLength + request.stderr.byteLength > request.outputMaxBytes) {
      child.kill("SIGKILL");
      settlePendingRequest((activeRequest) => {
        activeRequest.reject(createOutputExceededError(activeRequest.outputMaxBytes));
      });
      return;
    }
    const didSucceed = responseSuffix.equals(SUCCESS_RESPONSE_SUFFIX);
    const didFail = responseSuffix.equals(FAILURE_RESPONSE_SUFFIX);
    if (!didSucceed && !didFail) {
      child.kill("SIGKILL");
      settlePendingRequest((activeRequest) => {
        activeRequest.reject(createSpawnFailedError("worker returned an invalid response suffix"));
      });
      return;
    }
    settlePendingRequest((activeRequest) => {
      if (didSucceed) {
        activeRequest.resolve(output.toString("utf8").trim());
        return;
      }
      activeRequest.reject(
        createSpawnFailedError(activeRequest.stderr.toString("utf8").trim() || "worker failed"),
      );
    });
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const request = pendingRequest;
    if (request === null) return;
    request.stderr = Buffer.concat([request.stderr, chunk]);
    terminateForOutputLimit();
  });

  child.on("error", (error) => {
    settlePendingRequest((request) => request.reject(createSpawnFailedError(error)));
  });

  child.on("close", (code, signal) => {
    didClose = true;
    resolveClose();
    settlePendingRequest((request) =>
      request.reject(createTerminatedError(code, signal, request.stderr)),
    );
  });

  return {
    run: (runInput) =>
      new Promise<string>((resolve, reject) => {
        if (didClose) {
          reject(createSpawnFailedError("persistent oxlint worker is closed"));
          return;
        }
        if (pendingRequest !== null) {
          reject(createSpawnFailedError("persistent oxlint worker is already running"));
          return;
        }
        if (runInput.abortSignal?.aborted) {
          reject(createSpawnFailedError("lint phase aborted"));
          return;
        }
        runInput.onSpawn?.();
        const responseMarker = `\n\u001ereact-doctor:${randomUUID()}:`;
        const onAbort = (): void => {
          child.kill("SIGKILL");
          settlePendingRequest((request) =>
            request.reject(createSpawnFailedError("lint phase aborted")),
          );
        };
        const spawnTimeoutMs = runInput.spawnTimeoutMs ?? OXLINT_SPAWN_TIMEOUT_MS;
        const timeoutHandle = setTimeout(() => {
          child.kill("SIGKILL");
          settlePendingRequest((request) => {
            request.reject(
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
        pendingRequest = {
          resolve,
          reject,
          responseMarker: Buffer.from(responseMarker),
          outputMaxBytes: runInput.outputMaxBytes ?? OXLINT_OUTPUT_MAX_BYTES,
          abortSignal: runInput.abortSignal,
          onAbort,
          timeoutHandle,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
        };
        runInput.abortSignal?.addEventListener("abort", onAbort, { once: true });
        const request: PersistentOxlintWorkerRequest = {
          responseMarker,
          args: runInput.args,
          rootDirectory: runInput.rootDirectory,
        };
        try {
          child.stdin.write(`${JSON.stringify(request)}\n`);
        } catch (error) {
          settlePendingRequest((activeRequest) =>
            activeRequest.reject(createSpawnFailedError(error)),
          );
        }
      }),
    close: async () => {
      if (!didClose) child.kill("SIGKILL");
      await closePromise;
    },
  };
};

export const createPersistentOxlintWorkerPool = (
  input: PersistentOxlintWorkerPoolInput,
): PersistentOxlintWorkerPool => {
  const workerCount = Math.max(MIN_SCAN_CONCURRENCY, input.workerCount);
  const workerSlots = createWorkerSlots({
    slotCount: workerCount,
    createAbortError: () => createSpawnFailedError("lint phase aborted"),
  });
  const entries: WorkerPoolEntry[] = Array.from({ length: workerCount }, () => ({
    worker: null,
    completedRunCount: 0,
  }));
  const availableEntryIndexes = entries.map((_entry, index) => index);
  const pendingRuns = new Set<Promise<string>>();
  let didClose = false;
  let poolClosePromise: Promise<void> | null = null;

  const closeEntry = async (entry: WorkerPoolEntry): Promise<void> => {
    const worker = entry.worker;
    entry.worker = null;
    entry.completedRunCount = 0;
    await worker?.close();
  };

  const run = (runInput: OxlintBatchRunnerInput): Promise<string> => {
    if (didClose) {
      return Promise.reject(createSpawnFailedError("persistent oxlint worker pool is closed"));
    }
    const runPromise = workerSlots.run(async () => {
      if (didClose) throw createSpawnFailedError("persistent oxlint worker pool is closed");
      const entryIndex = availableEntryIndexes.shift();
      if (entryIndex === undefined) {
        throw createSpawnFailedError("persistent oxlint worker pool has no available worker");
      }
      const entry = entries[entryIndex];
      entry.worker ??= createPersistentOxlintWorker(input);
      try {
        const output = await entry.worker.run(runInput);
        entry.completedRunCount += 1;
        if (
          input.maxRunsPerWorker !== undefined &&
          entry.completedRunCount >= input.maxRunsPerWorker
        ) {
          await closeEntry(entry);
        }
        return output;
      } catch (error) {
        await closeEntry(entry);
        throw error;
      } finally {
        availableEntryIndexes.push(entryIndex);
      }
    }, runInput.abortSignal);
    pendingRuns.add(runPromise);
    void runPromise.then(
      () => pendingRuns.delete(runPromise),
      () => pendingRuns.delete(runPromise),
    );
    return runPromise;
  };

  const closePool = async (): Promise<void> => {
    didClose = true;
    await Promise.all(entries.map(closeEntry));
    await Promise.allSettled([...pendingRuns]);
  };

  return {
    run,
    close: () => {
      poolClosePromise ??= closePool();
      return poolClosePromise;
    },
  };
};
