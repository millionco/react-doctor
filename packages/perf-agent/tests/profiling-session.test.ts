import { describe, expect, it } from "vite-plus/test";
import { createProfilingSession } from "../src/devtools/profiling-session.js";
import type { ReactProfilerDataFrontend } from "../src/types/profiling-frontend.js";
import type {
  ReactDevtoolsProfilerEvent,
  ReactDevtoolsStore,
} from "../src/types/react-devtools.js";

interface FakeStoreOptions {
  emitSyncOnStop: boolean;
  data: ReactProfilerDataFrontend | null;
}

const createFakeStore = (options: FakeStoreOptions): ReactDevtoolsStore => {
  const listeners = new Map<ReactDevtoolsProfilerEvent, Set<() => void>>();
  let isProcessingData = false;
  const emit = (event: ReactDevtoolsProfilerEvent): void => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  return {
    profilerStore: {
      startProfiling: () => {},
      stopProfiling: () => {
        if (options.emitSyncOnStop) {
          // Reproduces the native no-renderer path: emits synchronously inside
          // stopProfiling, before stop() would historically register a listener.
          isProcessingData = false;
          emit("isProcessingData");
        } else {
          isProcessingData = true;
          queueMicrotask(() => {
            isProcessingData = false;
            emit("isProcessingData");
          });
        }
      },
      get isProcessingData() {
        return isProcessingData;
      },
      get didRecordCommits() {
        return options.data !== null;
      },
      get profilingData() {
        return options.data;
      },
      addListener: (event, listener) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      removeListener: (event, listener) => {
        listeners.get(event)?.delete(listener);
      },
    },
  };
};

describe("createProfilingSession.stop", () => {
  it("resolves when the store emits isProcessingData synchronously inside stopProfiling", async () => {
    const session = createProfilingSession(createFakeStore({ emitSyncOnStop: true, data: null }));
    session.start();
    expect(await session.stop()).toBeNull();
  });

  it("resolves with the serialized export on async completion", async () => {
    const data: ReactProfilerDataFrontend = {
      dataForRoots: new Map([
        [
          1,
          {
            commitData: [],
            displayName: "App",
            initialTreeBaseDurations: new Map(),
            operations: [],
            rootID: 1,
            snapshots: new Map(),
          },
        ],
      ]),
      timelineData: [],
      imported: false,
    };
    const session = createProfilingSession(createFakeStore({ emitSyncOnStop: false, data }));
    session.start();
    const result = await session.stop();
    expect(result?.version).toBe(5);
    expect(result?.dataForRoots).toHaveLength(1);
  });
});
