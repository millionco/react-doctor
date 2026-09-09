import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { DUPLICATE_JSX_WORKER_IDLE_TIMEOUT_MS } from "../constants.js";
import { messageFromUnknown } from "../utils/message-from-unknown.js";
import { createJsxSourceReader } from "./create-jsx-source-reader.js";
import {
  detectDuplicateJsxSubtreesCooperative,
  type DuplicateJsxSubtreesResult,
} from "./detect-duplicate-jsx-subtrees.js";
import {
  isDuplicateJsxWorkerReply,
  type DuplicateJsxDetectionRequest,
  type DuplicateJsxWorkerCommand,
  type DuplicateJsxWorkerFailure,
} from "./duplicate-jsx-worker-protocol.js";

export interface RunDuplicateJsxDetectionInput extends DuplicateJsxDetectionRequest {
  readonly signal?: AbortSignal;
  readonly workerScriptPath?: string;
}

interface PendingDetection {
  readonly resolve: (result: DuplicateJsxSubtreesResult) => void;
  readonly reject: (error: Error) => void;
  readonly dispose: () => void;
}

interface SharedDuplicateJsxWorker {
  readonly scriptPath: string;
  readonly worker: Worker;
  readonly pendingById: Map<number, PendingDetection>;
  idleTimer: NodeJS.Timeout | null;
  isDead: boolean;
}

const DEFAULT_WORKER_SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "duplicate-jsx-worker.js",
);

const sharedWorkersByScriptPath = new Map<string, SharedDuplicateJsxWorker>();
let nextRequestId = 0;

const buildWorkerError = (reply: DuplicateJsxWorkerFailure): Error => {
  const error = new Error(reply.error.message);
  if (reply.error.name !== undefined) error.name = reply.error.name;
  if (reply.error.stack !== undefined) error.stack = reply.error.stack;
  return error;
};

const retireWorker = (shared: SharedDuplicateJsxWorker, failure: Error | null): void => {
  if (shared.idleTimer !== null) clearTimeout(shared.idleTimer);
  shared.idleTimer = null;
  if (sharedWorkersByScriptPath.get(shared.scriptPath) === shared) {
    sharedWorkersByScriptPath.delete(shared.scriptPath);
  }
  if (shared.isDead) return;
  shared.isDead = true;
  for (const pending of shared.pendingById.values()) {
    pending.dispose();
    pending.reject(failure ?? new Error("Duplicate JSX worker exited before reporting."));
  }
  shared.pendingById.clear();
  void shared.worker.terminate();
};

const settleIdleState = (shared: SharedDuplicateJsxWorker): void => {
  if (shared.pendingById.size > 0) {
    if (shared.idleTimer !== null) clearTimeout(shared.idleTimer);
    shared.idleTimer = null;
    shared.worker.ref();
    return;
  }
  shared.worker.unref();
  shared.idleTimer ??= setTimeout(
    () => retireWorker(shared, null),
    DUPLICATE_JSX_WORKER_IDLE_TIMEOUT_MS,
  );
  shared.idleTimer.unref();
};

const createSharedWorker = (scriptPath: string): SharedDuplicateJsxWorker => {
  const worker = new Worker(scriptPath);
  const shared: SharedDuplicateJsxWorker = {
    scriptPath,
    worker,
    pendingById: new Map(),
    idleTimer: null,
    isDead: false,
  };
  worker.on("message", (message: unknown) => {
    if (!isDuplicateJsxWorkerReply(message)) return;
    const pending = shared.pendingById.get(message.id);
    if (pending === undefined) return;
    shared.pendingById.delete(message.id);
    pending.dispose();
    if (message.ok) pending.resolve(message.result);
    else pending.reject(buildWorkerError(message));
    settleIdleState(shared);
  });
  worker.once("error", (error: unknown) =>
    retireWorker(shared, error instanceof Error ? error : new Error(messageFromUnknown(error))),
  );
  worker.once("exit", (exitCode) =>
    retireWorker(shared, new Error(`Duplicate JSX worker exited with code ${exitCode}.`)),
  );
  return shared;
};

const acquireSharedWorker = (scriptPath: string): SharedDuplicateJsxWorker => {
  const existing = sharedWorkersByScriptPath.get(scriptPath);
  if (existing !== undefined && !existing.isDead) return existing;
  const shared = createSharedWorker(scriptPath);
  sharedWorkersByScriptPath.set(scriptPath, shared);
  return shared;
};

const runInWorker = (
  input: RunDuplicateJsxDetectionInput,
  scriptPath: string,
): Promise<DuplicateJsxSubtreesResult> =>
  new Promise((resolve, reject) => {
    const shared = acquireSharedWorker(scriptPath);
    const id = nextRequestId++;
    const send = (command: DuplicateJsxWorkerCommand): void => shared.worker.postMessage(command);
    const onAbort = (): void => send({ type: "abort", id });
    shared.pendingById.set(id, {
      resolve,
      reject,
      dispose: () => input.signal?.removeEventListener("abort", onAbort),
    });
    settleIdleState(shared);
    send({
      type: "detect",
      id,
      rootDirectory: input.rootDirectory,
      sourceFiles: input.sourceFiles,
    });
    input.signal?.addEventListener("abort", onAbort, { once: true });
  });

export const runDuplicateJsxDetection = (
  input: RunDuplicateJsxDetectionInput,
): Promise<DuplicateJsxSubtreesResult> => {
  const scriptPath = input.workerScriptPath ?? DEFAULT_WORKER_SCRIPT_PATH;
  if (input.signal?.aborted !== true && fs.existsSync(scriptPath)) {
    return runInWorker(input, scriptPath);
  }
  return detectDuplicateJsxSubtreesCooperative(createJsxSourceReader(input), {
    signal: input.signal,
  });
};
