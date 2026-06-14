import type {
  ReactDevtoolsProfilerEvent,
  ReactDevtoolsProfilerStore,
} from "../types/react-devtools.js";

/**
 * Resolves when `event` fires and `isSettled()` returns true. When `timeoutMs`
 * is given, also resolves after that long without a settling event — a guard so
 * a non-responding backend (no `profilingData` message) can't hang the caller.
 */
export const waitForStoreEvent = (
  profilerStore: ReactDevtoolsProfilerStore,
  event: ReactDevtoolsProfilerEvent,
  isSettled: () => boolean,
  timeoutMs?: number,
): Promise<void> =>
  new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handleEvent = (): void => {
      if (!isSettled()) return;
      if (timer !== undefined) clearTimeout(timer);
      profilerStore.removeListener(event, handleEvent);
      resolve();
    };
    profilerStore.addListener(event, handleEvent);
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        profilerStore.removeListener(event, handleEvent);
        resolve();
      }, timeoutMs);
    }
  });
