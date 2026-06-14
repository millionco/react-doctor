import type { ReactProfilerDataFrontend } from "./profiling-frontend.js";

// The global object the DevTools hook is installed on: `window` on the web,
// `global` on React Native. `globalThis` covers both.
export type DevtoolsGlobal = typeof globalThis;

export interface ReactDevtoolsWallMessage {
  event: string;
  payload: unknown;
}

/**
 * The transport DevTools uses between its backend and frontend. We supply a
 * synchronous in-page wall so both halves live in the same window with no
 * iframe and no `postMessage` round-trip.
 */
export interface ReactDevtoolsWall {
  listen: (listener: (message: ReactDevtoolsWallMessage) => void) => void;
  send: (event: string, payload: unknown) => void;
}

export interface ReactDevtoolsBridge {
  send: (event: string, payload?: unknown) => void;
  addListener: (event: string, listener: (payload: unknown) => void) => void;
  removeListener: (event: string, listener: (payload: unknown) => void) => void;
  shutdown: () => void;
}

export type ReactDevtoolsProfilerEvent = "isProcessingData" | "isProfiling" | "profilingData";

export interface ReactDevtoolsProfilerStore {
  startProfiling: () => void;
  stopProfiling: () => void;
  readonly isProcessingData: boolean;
  readonly didRecordCommits: boolean;
  readonly profilingData: ReactProfilerDataFrontend | null;
  addListener: (event: ReactDevtoolsProfilerEvent, listener: () => void) => void;
  removeListener: (event: ReactDevtoolsProfilerEvent, listener: () => void) => void;
}

export interface ReactDevtoolsStore {
  readonly profilerStore: ReactDevtoolsProfilerStore;
}
