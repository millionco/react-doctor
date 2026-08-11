export interface ActiveScanAbortRegistry {
  readonly register: (controller: AbortController) => () => void;
  readonly abortAll: () => void;
}

const activeScanAbortControllers = new Set<AbortController>();

export const activeScanAbortRegistry: ActiveScanAbortRegistry = {
  register: (controller) => {
    activeScanAbortControllers.add(controller);
    return () => activeScanAbortControllers.delete(controller);
  },
  abortAll: () => {
    const controllers = [...activeScanAbortControllers];
    activeScanAbortControllers.clear();
    for (const controller of controllers) controller.abort();
  },
};
