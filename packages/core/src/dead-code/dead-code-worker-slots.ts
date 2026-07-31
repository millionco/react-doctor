import { resolveDeadCodeConcurrency } from "../utils/resolve-dead-code-concurrency.js";
import { createWorkerSlots } from "../utils/create-worker-slots.js";
import type { WorkerSlots } from "../utils/create-worker-slots.js";

let deadCodeWorkerSlots: WorkerSlots | null = null;

export const withDeadCodeWorkerSlot = async <Result>(
  task: () => Promise<Result>,
  abortSignal?: AbortSignal,
): Promise<Result> => {
  deadCodeWorkerSlots ??= createWorkerSlots({
    slotCount: resolveDeadCodeConcurrency(),
    createAbortError: () => new Error("Dead-code worker aborted."),
  });
  return deadCodeWorkerSlots.run(task, abortSignal);
};
