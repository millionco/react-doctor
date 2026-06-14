import type {
  ReactDevtoolsProfilerEvent,
  ReactDevtoolsProfilerStore,
} from "../types/react-devtools.js";

export const waitForStoreEvent = (
  profilerStore: ReactDevtoolsProfilerStore,
  event: ReactDevtoolsProfilerEvent,
  isSettled: () => boolean,
): Promise<void> =>
  new Promise((resolve) => {
    const handleEvent = (): void => {
      if (!isSettled()) return;
      profilerStore.removeListener(event, handleEvent);
      resolve();
    };
    profilerStore.addListener(event, handleEvent);
  });
