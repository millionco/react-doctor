import { createWorkerSlots } from "../utils/create-worker-slots.js";
import type { WorkerSlots } from "../utils/create-worker-slots.js";
import { resolveProjectAnalysisConcurrency } from "../utils/resolve-project-analysis-concurrency.js";

let projectAnalysisWorkerSlots: WorkerSlots | null = null;

export const withProjectAnalysisWorkerSlot = async <Result>(
  task: () => Promise<Result>,
  abortSignal?: AbortSignal,
): Promise<Result> => {
  projectAnalysisWorkerSlots ??= createWorkerSlots({
    slotCount: resolveProjectAnalysisConcurrency(),
    createAbortError: () => new Error("Project analysis was cancelled."),
  });
  return projectAnalysisWorkerSlots.run(task, abortSignal);
};
