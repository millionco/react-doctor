import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { REACT_COMPILER_DETECTION_WORKER_IDLE_TIMEOUT_MS } from "../constants.js";
import {
  isReactCompilerDetectionReply,
  type ReactCompilerDetectionRequest,
} from "./react-compiler-detection-worker-protocol.js";

// React Compiler config detection is the one discovery step that needs the
// TypeScript compiler, and loading it costs the parent thread far more than
// the detection itself. One shared worker thread (kept for a short idle
// period so a workspace scan's members reuse its loaded compiler) evaluates
// it while the parent lists files and discovers the rest; `discoverProject`
// takes the answer if it is pending for the directory and otherwise detects
// synchronously as before.
const DEFAULT_WORKER_SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "react-compiler-detection-worker.js",
);

interface SharedDetectionWorker {
  readonly worker: Worker;
  readonly resolveById: Map<number, (hasReactCompiler: boolean | null) => void>;
  idleTimer: NodeJS.Timeout | null;
  isDead: boolean;
}

const pendingDetectionsByDirectory = new Map<string, Promise<boolean | null>>();
let sharedWorker: SharedDetectionWorker | null = null;
let nextRequestId = 0;

const retireWorker = (shared: SharedDetectionWorker): void => {
  if (shared.idleTimer !== null) clearTimeout(shared.idleTimer);
  shared.idleTimer = null;
  if (sharedWorker === shared) sharedWorker = null;
  if (shared.isDead) return;
  shared.isDead = true;
  for (const resolve of shared.resolveById.values()) resolve(null);
  shared.resolveById.clear();
  void shared.worker.terminate();
};

const settleIdleState = (shared: SharedDetectionWorker): void => {
  if (shared.resolveById.size > 0) {
    if (shared.idleTimer !== null) clearTimeout(shared.idleTimer);
    shared.idleTimer = null;
    shared.worker.ref();
    return;
  }
  shared.worker.unref();
  shared.idleTimer ??= setTimeout(
    () => retireWorker(shared),
    REACT_COMPILER_DETECTION_WORKER_IDLE_TIMEOUT_MS,
  );
  shared.idleTimer.unref();
};

const acquireSharedWorker = (scriptPath: string): SharedDetectionWorker | null => {
  if (sharedWorker !== null && !sharedWorker.isDead) return sharedWorker;
  let worker: Worker;
  try {
    worker = new Worker(scriptPath);
  } catch {
    return null;
  }
  const shared: SharedDetectionWorker = {
    worker,
    resolveById: new Map(),
    idleTimer: null,
    isDead: false,
  };
  worker.on("message", (message: unknown) => {
    if (!isReactCompilerDetectionReply(message)) return;
    const resolve = shared.resolveById.get(message.id);
    if (resolve === undefined) return;
    shared.resolveById.delete(message.id);
    resolve(message.hasReactCompiler);
    settleIdleState(shared);
  });
  worker.once("error", () => retireWorker(shared));
  worker.once("exit", () => retireWorker(shared));
  sharedWorker = shared;
  return shared;
};

const detectInWorker = (
  shared: SharedDetectionWorker,
  directory: string,
): Promise<boolean | null> =>
  new Promise((resolve) => {
    const request: ReactCompilerDetectionRequest = { id: nextRequestId++, directory };
    shared.resolveById.set(request.id, resolve);
    settleIdleState(shared);
    shared.worker.postMessage(request);
  });

export const warmReactCompilerDetection = (
  directory: string,
  scriptPath: string = DEFAULT_WORKER_SCRIPT_PATH,
): void => {
  if (pendingDetectionsByDirectory.has(directory) || !fs.existsSync(scriptPath)) return;
  const shared = acquireSharedWorker(scriptPath);
  if (shared === null) return;
  pendingDetectionsByDirectory.set(directory, detectInWorker(shared, directory));
};

export const takeReactCompilerDetection = (directory: string): Promise<boolean | null> | null => {
  const pending = pendingDetectionsByDirectory.get(directory) ?? null;
  if (pending !== null) pendingDetectionsByDirectory.delete(directory);
  return pending;
};
