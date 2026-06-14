import { PROFILING_STOP_TIMEOUT_MS } from "../constants.js";
import type { ReactProfilerDataExport } from "../types/profiling-export.js";
import type { ReactDevtoolsStore } from "../types/react-devtools.js";
import { serializeProfilingExport } from "../utils/serialize-profiling-export.js";
import { waitForStoreEvent } from "../utils/wait-for-store-event.js";

export interface ProfilingSession {
  start: () => void;
  stop: () => Promise<ReactProfilerDataExport | null>;
}

/**
 * Wraps the DevTools `ProfilerStore` start/stop lifecycle. `stop()` resolves
 * once the backend has finished serializing the session, returning the
 * canonical DevTools export — or `null` when no commits were recorded.
 */
export const createProfilingSession = (store: ReactDevtoolsStore): ProfilingSession => {
  const { profilerStore } = store;

  return {
    start: () => {
      profilerStore.startProfiling();
    },
    stop: async () => {
      // Register the listener BEFORE calling stopProfiling: a store may emit
      // `isProcessingData` synchronously inside stopProfiling (e.g. the native
      // store when no renderer attached), which would be missed if we awaited
      // after the call.
      const settled = waitForStoreEvent(
        profilerStore,
        "isProcessingData",
        () => profilerStore.isProcessingData === false,
        PROFILING_STOP_TIMEOUT_MS,
      );

      profilerStore.stopProfiling();

      // The backend serializes asynchronously over the bridge; `isProcessingData`
      // flips true while it works and back to false once the frontend has merged
      // every renderer's data.
      await settled;

      const { profilingData } = profilerStore;
      return profilingData === null ? null : serializeProfilingExport(profilingData);
    },
  };
};
