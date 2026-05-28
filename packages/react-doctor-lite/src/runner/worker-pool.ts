import { Worker } from "node:worker_threads";
import { chunkArray } from "../utils/chunk-array.js";
import type { DiagnosticSeverity, LiteDiagnostic, LoadedRule, WorkerTask } from "../types.js";

export interface RunWorkerPoolInput {
  filePaths: ReadonlyArray<string>;
  rules: ReadonlyArray<LoadedRule>;
  settings: Record<string, unknown>;
  poolSize: number;
  batchSize: number;
  // Overrides the resolved worker module URL. Used by tests to point a
  // source-mode run at the built `dist/worker.js`.
  workerUrl?: URL;
}

// The worker module is always a sibling sharing this module's extension —
// `dist/worker.js` next to the bundled `dist/index.js`, or
// `src/runner/worker.ts` next to `worker-pool.ts`. Raw-TS execution can't
// honor the `.js`-style import specifiers inside the worker, which is why the
// orchestrator only routes here in built (`.js`) mode.
const resolveWorkerUrl = (): URL => {
  const moduleUrl = import.meta.url;
  const extension = moduleUrl.slice(moduleUrl.lastIndexOf("."));
  return new URL(`./worker${extension}`, moduleUrl);
};

const buildTask = (
  filePaths: ReadonlyArray<string>,
  rules: ReadonlyArray<LoadedRule>,
  settings: Record<string, unknown>,
): WorkerTask => {
  const severityById: Record<string, DiagnosticSeverity> = {};
  for (const rule of rules) severityById[rule.id] = rule.severity;
  return {
    filePaths,
    enabledRuleIds: rules.map((rule) => rule.id),
    severityById,
    settings,
  };
};

// Distributes file batches across a fixed pool of worker threads so rule
// processing actually uses every core, instead of the sequential
// subprocess-per-batch model. Each idle worker is handed the next pending
// batch until the queue drains.
export const runWorkerPool = (input: RunWorkerPoolInput): Promise<LiteDiagnostic[]> => {
  const { filePaths, rules, settings, poolSize, batchSize } = input;
  const batches = chunkArray(filePaths, batchSize);
  const workerUrl = input.workerUrl ?? resolveWorkerUrl();
  const workerCount = Math.max(1, Math.min(poolSize, batches.length));

  return new Promise<LiteDiagnostic[]>((resolve, reject) => {
    const diagnostics: LiteDiagnostic[] = [];
    const workers: Worker[] = [];
    let nextBatchIndex = 0;
    let completedBatches = 0;
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      for (const worker of workers) void worker.terminate();
      if (error) reject(error);
      else resolve(diagnostics);
    };

    const assignNext = (worker: Worker): void => {
      if (nextBatchIndex >= batches.length) return;
      const batch = batches[nextBatchIndex++];
      worker.postMessage(buildTask(batch, rules, settings));
    };

    for (let index = 0; index < workerCount; index++) {
      const worker = new Worker(workerUrl);
      workers.push(worker);
      worker.on("message", (batchDiagnostics: LiteDiagnostic[]) => {
        diagnostics.push(...batchDiagnostics);
        completedBatches++;
        if (completedBatches === batches.length) finish();
        else assignNext(worker);
      });
      worker.on("error", finish);
      assignNext(worker);
    }
  });
};
