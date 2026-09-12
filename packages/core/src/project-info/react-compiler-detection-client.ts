import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  isReactCompilerDetectionReply,
  type ReactCompilerDetectionRequest,
} from "./react-compiler-detection-worker-protocol.js";

// React Compiler config detection is the one discovery step that needs the
// TypeScript compiler, and loading it costs the parent thread far more than
// the detection itself. A worker thread evaluates it while the parent lists
// files and discovers the rest; `discoverProject` takes the answer if it is
// pending for the directory and otherwise detects synchronously as before.
const DEFAULT_WORKER_SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "react-compiler-detection-worker.js",
);

const pendingDetectionsByDirectory = new Map<string, Promise<boolean | null>>();
let nextRequestId = 0;

const detectInWorker = (directory: string, scriptPath: string): Promise<boolean | null> =>
  new Promise((resolve) => {
    const request: ReactCompilerDetectionRequest = { id: nextRequestId++, directory };
    let worker: Worker;
    try {
      worker = new Worker(scriptPath);
    } catch {
      resolve(null);
      return;
    }
    const finish = (hasReactCompiler: boolean | null): void => {
      resolve(hasReactCompiler);
      void worker.terminate();
    };
    worker.on("message", (message: unknown) => {
      if (isReactCompilerDetectionReply(message) && message.id === request.id) {
        finish(message.hasReactCompiler);
      }
    });
    worker.once("error", () => finish(null));
    worker.once("exit", () => resolve(null));
    worker.postMessage(request);
  });

export const warmReactCompilerDetection = (
  directory: string,
  scriptPath: string = DEFAULT_WORKER_SCRIPT_PATH,
): void => {
  if (pendingDetectionsByDirectory.has(directory) || !fs.existsSync(scriptPath)) return;
  pendingDetectionsByDirectory.set(directory, detectInWorker(directory, scriptPath));
};

export const takeReactCompilerDetection = (directory: string): Promise<boolean | null> | null => {
  const pending = pendingDetectionsByDirectory.get(directory) ?? null;
  if (pending !== null) pendingDetectionsByDirectory.delete(directory);
  return pending;
};
