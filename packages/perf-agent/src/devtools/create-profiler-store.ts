import {
  activate as activateBackend,
  createBridge as createBackendBridge,
} from "react-devtools-inline/backend";
import { createBridge as createFrontendBridge, createStore } from "react-devtools-inline/frontend";
import type {
  DevtoolsGlobal,
  ReactDevtoolsStore,
  ReactDevtoolsWall,
  ReactDevtoolsWallMessage,
} from "../types/react-devtools.js";

/**
 * Web implementation: connects a headless DevTools frontend Store to the
 * already-installed backend over a synchronous in-page wall. The Store collects
 * operations + commit timings on its own; the DevTools UI is never rendered.
 *
 * React Native uses `create-profiler-store.native.ts` instead — the frontend
 * Store pulls in `react-dom`/`fs`, which an RN bundle cannot resolve.
 */
export const createProfilerStore = (target: DevtoolsGlobal = globalThis): ReactDevtoolsStore => {
  const listeners: Array<(message: ReactDevtoolsWallMessage) => void> = [];
  const wall: ReactDevtoolsWall = {
    listen: (listener) => {
      listeners.push(listener);
    },
    send: (event, payload) => {
      for (const listener of listeners) listener({ event, payload });
    },
  };

  const frontendBridge = createFrontendBridge(target, wall);
  const store = createStore(frontendBridge);

  // Activate only after the frontend bridge + store exist, else the backend
  // emits the initial tree before the store is listening (per the DevTools
  // inline contract).
  activateBackend(target, { bridge: createBackendBridge(target, wall) });

  return store;
};
