import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as net from "node:net";
import {
  MILLISECONDS_PER_SECOND,
  OXLINT_WORKER_IDLE_TIMEOUT_MS,
  OXLINT_WORKER_JOB_END_MARKER,
  OXLINT_WORKER_READY_TIMEOUT_MS,
} from "../../constants.js";
import { OxlintBatchExceeded, OxlintSpawnFailed, ReactDoctorError } from "../../errors.js";
import type { OxlintWorkerBootMessage, OxlintWorkerJobMessage } from "../../start-oxlint-worker.js";
import { buildOxlintExitError } from "../../utils/build-oxlint-exit-error.js";
import { buildOxlintWorkerNodeArguments } from "../../utils/build-oxlint-worker-node-arguments.js";
import { lowerChildProcessPriority } from "../../utils/lower-child-process-priority.js";
import { resolveOxlintThreadCount } from "../../utils/resolve-oxlint-thread-count.js";
import { resolveChildNodeVersion } from "./resolve-toolchain-versions.js";

export interface OxlintWorkerJob {
  readonly argumentsList: ReadonlyArray<string>;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly outputMaxBytes: number;
  readonly filesystemCacheEpoch: number | null;
  readonly abortSignal?: AbortSignal;
  readonly onStart?: () => void;
}

export interface OxlintWorkerPoolOptions {
  readonly nodeBinaryPath: string;
  readonly workerScriptPath: string;
  readonly oxlintPackageDirectory: string;
  readonly maxWorkers: number;
  readonly environment: NodeJS.ProcessEnv;
  readonly readyTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
}

export interface OxlintWorkerPool {
  readonly run: (job: OxlintWorkerJob) => Promise<string>;
  /** Boots idle workers up to `maxWorkers` so the first jobs skip the ~300ms worker startup. */
  readonly warm: () => void;
  readonly isAvailable: () => boolean;
  readonly workerCount: () => number;
  readonly closeIdleWorkers: () => void;
  /** Kills every worker; resolves once the host has reaped them all. */
  readonly close: () => Promise<void>;
}

// Raised instead of a `ReactDoctorError` when the pool cannot serve jobs at
// all (worker script failed to boot, oxlint internals missing at runtime), so
// the caller falls back to the per-batch spawn path rather than reporting a
// lint failure.
export class OxlintWorkerUnavailableError extends Error {
  constructor(detail: string) {
    super(`oxlint worker pool unavailable: ${detail}`);
    this.name = "OxlintWorkerUnavailableError";
  }
}

interface OutputCollector {
  readonly chunks: Buffer[];
  totalLength: number;
}

interface JobEnd {
  readonly outputLength: number;
  readonly token: string;
}

interface PendingJob {
  readonly id: number;
  readonly job: OxlintWorkerJob;
  readonly resolve: (stdout: string) => void;
  readonly reject: (error: unknown) => void;
  readonly stdout: OutputCollector;
  readonly stderr: OutputCollector;
  readonly settle: () => void;
  didKillForSize: boolean;
}

interface WaitingJob {
  readonly job: OxlintWorkerJob;
  readonly resolve: (stdout: string) => void;
  readonly reject: (error: unknown) => void;
  readonly detachAbort: () => void;
}

interface Worker {
  readonly child: ChildProcess;
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  current: PendingJob | null;
  idleTimer: NodeJS.Timeout | null;
  isReady: boolean;
  isDead: boolean;
  isReclaimed: boolean;
}

const MAX_END_TOKEN_BYTES = 64;

const createOutputCollector = (): OutputCollector => ({ chunks: [], totalLength: 0 });

const buildJobEndMarker = (jobId: number): Buffer =>
  Buffer.from(`\n${OXLINT_WORKER_JOB_END_MARKER}:${jobId}:`);

// The end marker is always the last thing written for a job, so only the
// stream's tail needs scanning; the marker may straddle chunk boundaries,
// hence the join of the final few chunks.
const findJobEnd = (collector: OutputCollector, marker: Buffer): JobEnd | null => {
  const tailChunks: Buffer[] = [];
  let tailLength = 0;
  for (
    let chunkIndex = collector.chunks.length - 1;
    chunkIndex >= 0 && tailLength < marker.length + MAX_END_TOKEN_BYTES;
    chunkIndex--
  ) {
    const chunk = collector.chunks[chunkIndex];
    if (chunk === undefined) break;
    tailChunks.unshift(chunk);
    tailLength += chunk.length;
  }
  const tail = Buffer.concat(tailChunks);
  const markerIndex = tail.lastIndexOf(marker);
  if (markerIndex === -1) return null;
  const trailer = tail.subarray(markerIndex + marker.length).toString("utf8");
  const newlineIndex = trailer.indexOf("\n");
  if (newlineIndex === -1) return null;
  return {
    outputLength: collector.totalLength - (tail.length - markerIndex),
    token: trailer.slice(0, newlineIndex),
  };
};

const readOutput = (collector: OutputCollector, length: number = collector.totalLength): string =>
  Buffer.concat(collector.chunks).subarray(0, length).toString("utf8").trim();

const buildAbortedError = (): ReactDoctorError =>
  new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause: "lint phase aborted" }) });

const isBootMessage = (message: unknown): message is OxlintWorkerBootMessage =>
  typeof message === "object" &&
  message !== null &&
  "type" in message &&
  (message.type === "ready" || message.type === "unavailable");

const setStreamRef = (stream: unknown, shouldRef: boolean): void => {
  if (!(stream instanceof net.Socket)) return;
  if (shouldRef) {
    stream.ref();
  } else {
    stream.unref();
  }
};

// Idle workers must not hold the host's event loop open (the CLI exits by
// draining the loop), so every handle is unref'd between jobs.
const setWorkerRef = (worker: Worker, shouldRef: boolean): void => {
  const { child } = worker;
  if (shouldRef) {
    child.ref();
    child.channel?.ref();
  } else {
    child.unref();
    child.channel?.unref();
  }
  setStreamRef(child.stdout, shouldRef);
  setStreamRef(child.stderr, shouldRef);
};

export const createOxlintWorkerPool = (options: OxlintWorkerPoolOptions): OxlintWorkerPool => {
  const readyTimeoutMs = options.readyTimeoutMs ?? OXLINT_WORKER_READY_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? OXLINT_WORKER_IDLE_TIMEOUT_MS;
  const workers = new Set<Worker>();
  const idleWorkers: Worker[] = [];
  const waitingJobs: WaitingJob[] = [];
  let unavailableDetail: string | null = null;
  let nextJobId = 1;

  // Re-ref before killing so the host waits for the exit and reaps the child
  // (its CPU time is then attributed to the scan instead of leaking to init).
  const killWorker = (worker: Worker): void => {
    if (worker.idleTimer !== null) clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
    if (worker.isDead) return;
    setWorkerRef(worker, true);
    worker.child.kill("SIGKILL");
  };

  // A worker the pool kills on purpose (job timeout, abort, output ceiling,
  // idle) may still be booting; its exit must not be mistaken for a boot
  // failure that takes the whole pool down.
  const reclaimWorker = (worker: Worker): void => {
    worker.isReclaimed = true;
    killWorker(worker);
  };

  const markUnavailable = (detail: string): void => {
    if (unavailableDetail === null) unavailableDetail = detail;
    for (const worker of workers) killWorker(worker);
    const error = new OxlintWorkerUnavailableError(detail);
    for (const waiting of waitingJobs.splice(0)) {
      waiting.detachAbort();
      waiting.reject(error);
    }
  };

  const failPending = (worker: Worker, pending: PendingJob, error: unknown): void => {
    if (worker.current === pending) worker.current = null;
    pending.settle();
    pending.reject(error);
  };

  const completePending = (worker: Worker, pending: PendingJob): void => {
    const marker = buildJobEndMarker(pending.id);
    const stdoutEnd = findJobEnd(pending.stdout, marker);
    const stderrEnd = findJobEnd(pending.stderr, marker);
    if (stdoutEnd === null || stderrEnd === null) return;
    pending.settle();
    worker.current = null;
    const stdout = readOutput(pending.stdout, stdoutEnd.outputLength);
    const stderr = readOutput(pending.stderr, stderrEnd.outputLength);
    if (stdoutEnd.token === "error" || (!stdout && stderr)) {
      pending.reject(
        new ReactDoctorError({
          reason: new OxlintSpawnFailed({ cause: stderr || "oxlint worker job failed" }),
        }),
      );
    } else {
      pending.resolve(stdout);
    }
    releaseWorker(worker);
  };

  const onWorkerData = (worker: Worker, isStdout: boolean, chunk: Buffer): void => {
    const pending = worker.current;
    if (pending === null || pending.didKillForSize) return;
    const collector = isStdout ? pending.stdout : pending.stderr;
    collector.chunks.push(chunk);
    collector.totalLength += chunk.length;
    if (pending.stdout.totalLength + pending.stderr.totalLength > pending.job.outputMaxBytes) {
      pending.didKillForSize = true;
      reclaimWorker(worker);
      return;
    }
    completePending(worker, pending);
  };

  const onWorkerClose = (
    worker: Worker,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    worker.isDead = true;
    if (worker.idleTimer !== null) clearTimeout(worker.idleTimer);
    workers.delete(worker);
    const idleIndex = idleWorkers.indexOf(worker);
    if (idleIndex !== -1) idleWorkers.splice(idleIndex, 1);
    const pending = worker.current;
    if (pending !== null) {
      const stderrOutput = readOutput(pending.stderr);
      const error =
        !worker.isReady && !worker.isReclaimed
          ? new OxlintWorkerUnavailableError(
              `worker exited before ready (code ${code ?? "null"}, signal ${signal ?? "none"})${stderrOutput ? `: ${stderrOutput}` : ""}`,
            )
          : pending.didKillForSize
            ? new ReactDoctorError({
                reason: new OxlintBatchExceeded({
                  kind: "output-too-large",
                  detail: `exceeded ${pending.job.outputMaxBytes} bytes — scan a smaller subset with --diff or --staged`,
                }),
              })
            : (buildOxlintExitError({ exitCode: code, signal, stderrOutput }) ??
              new ReactDoctorError({
                reason: new OxlintSpawnFailed({
                  cause: stderrOutput || `oxlint worker exited with code ${code ?? "null"}`,
                }),
              }));
      failPending(worker, pending, error);
    }
    dispatchWaiting();
  };

  const createWorker = (): Worker => {
    const child = spawn(
      options.nodeBinaryPath,
      [
        ...buildOxlintWorkerNodeArguments({
          childNodeVersion: resolveChildNodeVersion(options.nodeBinaryPath),
          nativeThreadCount: resolveOxlintThreadCount(options.maxWorkers),
        }),
        options.workerScriptPath,
        options.oxlintPackageDirectory,
      ],
      {
        env: options.environment,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      },
    );
    lowerChildProcessPriority(child.pid);
    let resolveReady: () => void = () => undefined;
    let rejectReady: (error: OxlintWorkerUnavailableError) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const readyTimer = setTimeout(() => {
      rejectReady(new OxlintWorkerUnavailableError("worker did not report ready in time"));
      killWorker(worker);
    }, readyTimeoutMs);
    readyTimer.unref();
    const worker: Worker = {
      child,
      ready,
      closed: new Promise<void>((resolve) => child.once("close", () => resolve())),
      current: null,
      idleTimer: null,
      isReady: false,
      isDead: false,
      isReclaimed: false,
    };
    ready.then(
      () => {
        clearTimeout(readyTimer);
        worker.isReady = true;
      },
      (error: unknown) => {
        clearTimeout(readyTimer);
        if (worker.isReclaimed) return;
        markUnavailable(error instanceof Error ? error.message : String(error));
      },
    );
    child.on("message", (message: unknown) => {
      if (!isBootMessage(message)) return;
      if (message.type === "ready") {
        worker.isReady = true;
        resolveReady();
      } else {
        rejectReady(new OxlintWorkerUnavailableError(message.message));
      }
    });
    child.on("error", (error) =>
      rejectReady(new OxlintWorkerUnavailableError(`worker spawn failed: ${error.message}`)),
    );
    child.stdout?.on("data", (chunk: Buffer) => onWorkerData(worker, true, chunk));
    child.stderr?.on("data", (chunk: Buffer) => onWorkerData(worker, false, chunk));
    child.on("close", (code, signal) => {
      rejectReady(
        new OxlintWorkerUnavailableError(
          `worker exited before ready (code ${code ?? "null"}, signal ${signal ?? "none"})`,
        ),
      );
      onWorkerClose(worker, code, signal);
    });
    workers.add(worker);
    return worker;
  };

  const releaseWorker = (worker: Worker): void => {
    if (worker.isDead) return;
    const waiting = waitingJobs.shift();
    if (waiting !== undefined) {
      waiting.detachAbort();
      startJob(worker, waiting);
      return;
    }
    idleWorkers.push(worker);
    setWorkerRef(worker, false);
    worker.idleTimer = setTimeout(() => reclaimWorker(worker), idleTimeoutMs);
    worker.idleTimer.unref();
  };

  const startJob = (worker: Worker, { job, resolve, reject }: WaitingJob): void => {
    if (worker.idleTimer !== null) clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
    setWorkerRef(worker, true);
    const id = nextJobId++;
    let timeoutHandle: NodeJS.Timeout | null = null;
    const onAbort = (): void => {
      failPending(worker, pending, buildAbortedError());
      reclaimWorker(worker);
    };
    const pending: PendingJob = {
      id,
      job,
      resolve,
      reject,
      stdout: createOutputCollector(),
      stderr: createOutputCollector(),
      settle: () => {
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        job.abortSignal?.removeEventListener("abort", onAbort);
      },
      didKillForSize: false,
    };
    timeoutHandle = setTimeout(() => {
      failPending(
        worker,
        pending,
        new ReactDoctorError({
          reason: new OxlintBatchExceeded({
            kind: "timeout",
            detail: `${job.timeoutMs / MILLISECONDS_PER_SECOND}s budget exceeded`,
          }),
        }),
      );
      reclaimWorker(worker);
    }, job.timeoutMs);
    timeoutHandle.unref();
    job.abortSignal?.addEventListener("abort", onAbort, { once: true });
    worker.current = pending;
    job.onStart?.();
    const message: OxlintWorkerJobMessage = {
      type: "job",
      id,
      cwd: job.cwd,
      argumentsList: job.argumentsList,
      filesystemCacheEpoch: job.filesystemCacheEpoch,
    };
    void worker.ready.then(
      () => {
        if (worker.current !== pending) return;
        worker.child.send(message, (error) => {
          if (error === null || worker.current !== pending) return;
          failPending(
            worker,
            pending,
            new OxlintWorkerUnavailableError(`worker IPC failed: ${error.message}`),
          );
          killWorker(worker);
        });
      },
      (error: unknown) => {
        if (worker.current === pending) failPending(worker, pending, error);
      },
    );
  };

  const dispatchWaiting = (): void => {
    while (waitingJobs.length > 0 && unavailableDetail === null) {
      const worker =
        idleWorkers.pop() ?? (workers.size < options.maxWorkers ? createWorker() : null);
      if (worker === null) return;
      const waiting = waitingJobs.shift();
      if (waiting === undefined) return;
      waiting.detachAbort();
      startJob(worker, waiting);
    }
  };

  const warm = (): void => {
    while (unavailableDetail === null && workers.size < options.maxWorkers) {
      releaseWorker(createWorker());
    }
  };

  const closeIdleWorkers = (): void => {
    for (const worker of idleWorkers.splice(0)) reclaimWorker(worker);
  };

  const run = (job: OxlintWorkerJob): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      if (unavailableDetail !== null) {
        reject(new OxlintWorkerUnavailableError(unavailableDetail));
        return;
      }
      if (job.abortSignal?.aborted) {
        reject(buildAbortedError());
        return;
      }
      const onWaitingAbort = (): void => {
        const waitingIndex = waitingJobs.indexOf(waiting);
        if (waitingIndex !== -1) waitingJobs.splice(waitingIndex, 1);
        reject(buildAbortedError());
      };
      const waiting: WaitingJob = {
        job,
        resolve,
        reject,
        detachAbort: () => job.abortSignal?.removeEventListener("abort", onWaitingAbort),
      };
      job.abortSignal?.addEventListener("abort", onWaitingAbort, { once: true });
      waitingJobs.push(waiting);
      dispatchWaiting();
    });

  return {
    run,
    warm,
    isAvailable: () => unavailableDetail === null,
    workerCount: () => workers.size,
    closeIdleWorkers,
    close: () => {
      const closing = [...workers].map((worker) => worker.closed);
      markUnavailable("pool closed");
      return Promise.all(closing).then(() => undefined);
    },
  };
};
