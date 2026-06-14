import { describe, expect, it } from "vite-plus/test";
import { waitForStoreEvent } from "../src/utils/wait-for-store-event.js";
import type {
  ReactDevtoolsProfilerEvent,
  ReactDevtoolsProfilerStore,
} from "../src/types/react-devtools.js";

const createStub = (): {
  store: ReactDevtoolsProfilerStore;
  emit: (event: ReactDevtoolsProfilerEvent) => void;
} => {
  const listeners = new Map<ReactDevtoolsProfilerEvent, Set<() => void>>();
  const store: ReactDevtoolsProfilerStore = {
    startProfiling: () => {},
    stopProfiling: () => {},
    isProcessingData: false,
    didRecordCommits: false,
    profilingData: null,
    addListener: (event, listener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener: (event, listener) => {
      listeners.get(event)?.delete(listener);
    },
  };
  const emit = (event: ReactDevtoolsProfilerEvent): void => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  return { store, emit };
};

describe("waitForStoreEvent", () => {
  it("resolves via the timeout when no settling event arrives", async () => {
    const { store } = createStub();
    await waitForStoreEvent(store, "isProcessingData", () => false, 20);
    expect(true).toBe(true);
  });

  it("resolves when the event fires and the predicate is satisfied", async () => {
    const { store, emit } = createStub();
    let settled = false;
    const promise = waitForStoreEvent(store, "isProcessingData", () => settled, 1000);
    settled = true;
    emit("isProcessingData");
    await promise;
    expect(settled).toBe(true);
  });
});
