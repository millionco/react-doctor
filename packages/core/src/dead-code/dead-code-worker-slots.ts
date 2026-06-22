import { resolveDeadCodeConcurrency } from "../utils/resolve-dead-code-concurrency.js";

// A process-global counting semaphore bounding how many real deslop dead-code
// child processes run at once, to the memory budget (`resolveDeadCodeConcurrency`).
//
// It's process-global on purpose: the CLI scans the projects of a workspace in
// concurrent `runInspect` fibers within ONE process, and each spawns its own
// dead-code worker — without a shared cap, N concurrent projects could
// oversubscribe memory with N simultaneous children on a small runner. This
// gates only HOW MANY start; each worker still self-terminates via the proven
// one-shot lifecycle (spawn → analyze → exit), so the semaphore adds no
// process-lifecycle surface — it's plain in-process bookkeeping.
//
// `-1` is the un-initialized sentinel; the first acquirer reads the budget once
// (after which the cap is fixed for the process).
let availableSlots = -1;
const waiters: Array<() => void> = [];

const releaseSlot = (): void => {
  const nextWaiter = waiters.shift();
  // Hand the slot straight to the next waiter (no increment); only return it to
  // the pool when nobody is waiting. Keeps the count balanced either way.
  if (nextWaiter !== undefined) nextWaiter();
  else availableSlots += 1;
};

/**
 * Runs `task` once a dead-code worker slot is free, releasing the slot when the
 * task settles (success or failure). With a high cap (roomy machine) every
 * caller proceeds immediately; with a low cap (constrained runner) callers
 * queue and run as slots free.
 */
export const withDeadCodeWorkerSlot = async <Result>(
  task: () => Promise<Result>,
): Promise<Result> => {
  if (availableSlots < 0) availableSlots = resolveDeadCodeConcurrency();
  if (availableSlots > 0) {
    availableSlots -= 1;
  } else {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  try {
    return await task();
  } finally {
    releaseSlot();
  }
};
