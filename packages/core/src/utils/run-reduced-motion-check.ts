import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { checkReducedMotion } from "../check-reduced-motion.js";
import type { Diagnostic } from "../types/index.js";
import { hasMotionLibraryDependency } from "./has-motion-library-dependency.js";

const DEFAULT_WORKER_SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "reduced-motion-worker.js",
);

interface RunReducedMotionCheckInput {
  readonly rootDirectory: string;
  readonly signal?: AbortSignal;
  readonly workerScriptPath?: string;
}

export const runReducedMotionCheck = async ({
  rootDirectory,
  signal,
  workerScriptPath = DEFAULT_WORKER_SCRIPT_PATH,
}: RunReducedMotionCheckInput): Promise<Diagnostic[]> => {
  signal?.throwIfAborted();
  if (!hasMotionLibraryDependency(rootDirectory)) return [];
  if (!fs.existsSync(workerScriptPath)) return checkReducedMotion(rootDirectory);

  let worker: Worker;
  try {
    worker = new Worker(workerScriptPath, { workerData: rootDirectory });
  } catch {
    return checkReducedMotion(rootDirectory);
  }

  return new Promise((resolve, reject) => {
    let isSettled = false;
    const settle = (): boolean => {
      if (isSettled) return false;
      isSettled = true;
      signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      return true;
    };
    const onAbort = (): void => {
      if (settle()) reject(signal?.reason);
    };
    const fallBack = (): void => {
      if (settle()) resolve(Promise.resolve().then(() => checkReducedMotion(rootDirectory)));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (diagnostics: Diagnostic[]) => {
      if (settle()) resolve(diagnostics);
    });
    worker.once("error", fallBack);
    worker.once("exit", fallBack);
  });
};
