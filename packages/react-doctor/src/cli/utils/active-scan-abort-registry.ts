export interface ActiveScanAbortRegistry {
  readonly register: (controller: AbortController) => () => void;
  readonly registerCleanup: (cleanup: () => Promise<void>) => () => void;
  readonly abortAll: () => Promise<void>;
}

const activeScanAbortControllers = new Set<AbortController>();
const activeScanCleanups = new Set<() => Promise<void>>();

export const activeScanAbortRegistry: ActiveScanAbortRegistry = {
  register: (controller) => {
    activeScanAbortControllers.add(controller);
    return () => activeScanAbortControllers.delete(controller);
  },
  registerCleanup: (cleanup) => {
    activeScanCleanups.add(cleanup);
    return () => activeScanCleanups.delete(cleanup);
  },
  abortAll: async () => {
    const controllers = [...activeScanAbortControllers];
    const cleanups = [...activeScanCleanups];
    activeScanAbortControllers.clear();
    activeScanCleanups.clear();
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(cleanups.map((cleanup) => cleanup()));
  },
};
