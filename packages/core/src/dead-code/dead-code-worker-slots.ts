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
 *
 * `abortSignal` short-circuits the WAIT: if it's already aborted, or fires while
 * this caller is queued, the call rejects without acquiring a slot or running
 * `task` — so a cancelled scan (e.g. lint failed) doesn't sit in the queue and
 * then spawn a child only to tear it down. A queued caller that aborts removes
 * its own waiter so a later release never hands a slot to a dead request.
 */
export const withDeadCodeWorkerSlot = async <Result>(
  task: () => Promise<Result>,
  abortSignal?: AbortSignal,
): Promise<Result> => {
  if (abortSignal?.aborted) throw new Error("Dead-code worker aborted.");
  if (availableSlots < 0) availableSlots = resolveDeadCodeConcurrency();
  if (availableSlots > 0) {
    availableSlots -= 1;
  } else {
    await new Promise<void>((resolve, reject) => {
      const waiter = (): void => {
        abortSignal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = (): void => {
        const queuedIndex = waiters.indexOf(waiter);
        if (queuedIndex !== -1) waiters.splice(queuedIndex, 1);
        reject(new Error("Dead-code worker aborted."));
      };
      waiters.push(waiter);
      abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  try {
    return await task();
  } finally {
    releaseSlot();
  }
};
