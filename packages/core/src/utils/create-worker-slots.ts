export interface WorkerSlots {
  readonly run: <Result>(task: () => Promise<Result>, abortSignal?: AbortSignal) => Promise<Result>;
}

interface WorkerSlotWaiter {
  readonly resolve: () => void;
  readonly abortSignal: AbortSignal | undefined;
  readonly onAbort: () => void;
}

interface CreateWorkerSlotsInput {
  readonly slotCount: number;
  readonly createAbortError: () => Error;
}

export const createWorkerSlots = (input: CreateWorkerSlotsInput): WorkerSlots => {
  let availableSlotCount = input.slotCount;
  const waiters: WorkerSlotWaiter[] = [];

  const releaseSlot = (): void => {
    const nextWaiter = waiters.shift();
    if (nextWaiter === undefined) {
      availableSlotCount += 1;
      return;
    }
    nextWaiter.abortSignal?.removeEventListener("abort", nextWaiter.onAbort);
    nextWaiter.resolve();
  };

  const acquireSlot = async (abortSignal?: AbortSignal): Promise<void> => {
    if (abortSignal?.aborted) throw input.createAbortError();
    if (availableSlotCount > 0) {
      availableSlotCount -= 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const waiterIndex = waiters.indexOf(waiter);
        if (waiterIndex !== -1) waiters.splice(waiterIndex, 1);
        reject(input.createAbortError());
      };
      const waiter: WorkerSlotWaiter = {
        resolve,
        abortSignal,
        onAbort,
      };
      waiters.push(waiter);
      abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  return {
    run: async <Result>(
      task: () => Promise<Result>,
      abortSignal?: AbortSignal,
    ): Promise<Result> => {
      await acquireSlot(abortSignal);
      try {
        return await task();
      } finally {
        releaseSlot();
      }
    },
  };
};
