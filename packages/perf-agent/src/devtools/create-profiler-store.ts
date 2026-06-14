import {
  activate as activateBackend,
  createBridge as createBackendBridge,
} from "react-devtools-inline/backend";
import { createBridge as createFrontendBridge, createStore } from "react-devtools-inline/frontend";
import type {
  ReactDevtoolsStore,
  ReactDevtoolsWall,
  ReactDevtoolsWallMessage,
} from "../types/react-devtools.js";

/**
 * Connects a headless DevTools frontend Store to the already-installed backend
 * over a synchronous in-page wall. The Store collects operations + commit
 * timings on its own; the DevTools UI component is never rendered.
 */
export const createProfilerStore = (targetWindow: Window = window): ReactDevtoolsStore => {
  const listeners: Array<(message: ReactDevtoolsWallMessage) => void> = [];
  const wall: ReactDevtoolsWall = {
    listen: (listener) => {
      listeners.push(listener);
    },
    send: (event, payload) => {
      for (const listener of listeners) listener({ event, payload });
    },
  };

  const frontendBridge = createFrontendBridge(targetWindow, wall);
  const store = createStore(frontendBridge);

  // Activate only after the frontend bridge + store exist, else the backend
  // emits the initial tree before the store is listening (per the DevTools
  // inline contract).
  activateBackend(targetWindow, { bridge: createBackendBridge(targetWindow, wall) });

  return store;
};
