import {
  activate as activateBackend,
  createBridge as createBackendBridge,
} from "react-devtools-inline/backend";
import type { DevtoolsElementTree } from "../types/element-tree.js";
import type { ReactProfilerDataBackend } from "../types/profiling-backend.js";
import type { ReactProfilerDataFrontend } from "../types/profiling-frontend.js";
import type { ReactProfilerSnapshotNode } from "../types/profiling-export.js";
import type {
  DevtoolsGlobal,
  ReactDevtoolsBridge,
  ReactDevtoolsProfilerEvent,
  ReactDevtoolsProfilerStore,
  ReactDevtoolsStore,
  ReactDevtoolsWall,
  ReactDevtoolsWallMessage,
} from "../types/react-devtools.js";
import { applyOperationsToTree } from "./operations/apply-operations-to-tree.js";
import { assembleFrontendData } from "./operations/assemble-frontend-data.js";
import { takeTreeSnapshot } from "./operations/take-tree-snapshot.js";

const isProfilerDataBackend = (value: unknown): value is ReactProfilerDataBackend =>
  typeof value === "object" &&
  value !== null &&
  "dataForRoots" in value &&
  Array.isArray(value.dataForRoots) &&
  "rendererID" in value &&
  typeof value.rendererID === "number";

/**
 * React Native implementation. The DevTools frontend Store can't run here (it
 * pulls in `react-dom`/`fs`), so we connect only the RN-safe DevTools backend
 * over a custom wall and assemble the export ourselves: backend `getProfilingData`
 * supplies the per-commit timings; we observe `operations` on the wall to keep
 * an element tree for the snapshots.
 *
 * Experimental: the bridge handshake mirrors the documented inline pattern but
 * has not been verified on a device. Snapshot reconstruction handles the
 * fixed-width operation opcodes and bails on the variable-width Suspense ops.
 */
export const createProfilerStore = (target: DevtoolsGlobal = globalThis): ReactDevtoolsStore => {
  const eventListeners = new Map<ReactDevtoolsProfilerEvent, Set<() => void>>();
  const emit = (event: ReactDevtoolsProfilerEvent): void => {
    for (const listener of eventListeners.get(event) ?? []) listener();
  };

  const tree: DevtoolsElementTree = new Map();
  const operationsByRootID = new Map<number, Array<Array<number>>>();
  const snapshotsByRootID = new Map<number, Map<number, ReactProfilerSnapshotNode>>();
  let rendererID: number | null = null;
  let isProfiling = false;
  let isProcessingData = false;
  let profilingData: ReactProfilerDataFrontend | null = null;

  const wallListeners: Array<(message: ReactDevtoolsWallMessage) => void> = [];
  const wall: ReactDevtoolsWall = {
    listen: (listener) => {
      wallListeners.push(listener);
    },
    send: (event, payload) => {
      for (const listener of wallListeners) listener({ event, payload });
    },
  };

  const frontendBridge: ReactDevtoolsBridge = createBackendBridge(target, wall);

  frontendBridge.addListener("getSavedPreferences", () => {
    frontendBridge.send("savedPreferences", {
      appendComponentStack: true,
      breakOnConsoleErrors: false,
      componentFilters: [],
      showInlineWarningsAndErrors: true,
      hideConsoleLogsInStrictMode: false,
    });
  });

  frontendBridge.addListener("operations", (payload) => {
    if (!Array.isArray(payload)) return;
    const rootID = payload[1] ?? 0;
    if (isProfiling) {
      const bucket = operationsByRootID.get(rootID) ?? [];
      bucket.push(payload);
      operationsByRootID.set(rootID, bucket);
    }
    const result = applyOperationsToTree(tree, payload);
    rendererID = result.rendererID;
  });

  frontendBridge.addListener("profilingData", (payload) => {
    if (!isProfilerDataBackend(payload)) {
      // A malformed payload must still settle processing, else `stop()` hangs.
      isProcessingData = false;
      emit("isProcessingData");
      return;
    }
    profilingData = assembleFrontendData({
      dataBackend: payload,
      operationsByRootID,
      snapshotsByRootID,
    });
    isProcessingData = false;
    emit("isProcessingData");
    emit("profilingData");
  });

  activateBackend(target, { bridge: createBackendBridge(target, wall) });
  frontendBridge.send("getProfilingStatus");

  const profilerStore: ReactDevtoolsProfilerStore = {
    startProfiling: () => {
      operationsByRootID.clear();
      snapshotsByRootID.clear();
      profilingData = null;
      for (const node of tree.values()) {
        if (node.parentID === 0) snapshotsByRootID.set(node.id, takeTreeSnapshot(tree, node.id));
      }
      isProfiling = true;
      frontendBridge.send("startProfiling", {
        recordChangeDescriptions: true,
        recordTimeline: false,
      });
      emit("isProfiling");
    },
    stopProfiling: () => {
      isProfiling = false;
      emit("isProfiling");
      // Always tell the backend to stop, even with no renderer observed, so it
      // never stays in recording mode after a startProfiling.
      frontendBridge.send("stopProfiling");
      if (rendererID === null) {
        isProcessingData = false;
        emit("isProcessingData");
        return;
      }
      isProcessingData = true;
      frontendBridge.send("getProfilingData", { rendererID });
    },
    get isProcessingData() {
      return isProcessingData;
    },
    get didRecordCommits() {
      return profilingData !== null && profilingData.dataForRoots.size > 0;
    },
    get profilingData() {
      return profilingData;
    },
    addListener: (event, listener) => {
      const set = eventListeners.get(event) ?? new Set();
      set.add(listener);
      eventListeners.set(event, set);
    },
    removeListener: (event, listener) => {
      eventListeners.get(event)?.delete(listener);
    },
  };

  return { profilerStore };
};
