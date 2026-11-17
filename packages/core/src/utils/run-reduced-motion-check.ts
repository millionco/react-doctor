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

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerScriptPath, { workerData: rootDirectory });
    const onAbort = (): void => {
      void worker.terminate();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (diagnostics: Diagnostic[]) => {
      signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      resolve(diagnostics);
    });
    worker.once("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      reject(error);
    });
    worker.once("exit", (exitCode) => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(`Reduced-motion worker exited with code ${exitCode} before replying.`));
    });
  });
};
