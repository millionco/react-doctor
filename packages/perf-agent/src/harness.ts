import { createProfilerStore } from "./devtools/create-profiler-store.js";
import { createProfilingSession } from "./devtools/profiling-session.js";
import { installReactDevtoolsBackend } from "./devtools/install-backend.js";
import type { ReactProfilerDataExport } from "./types/profiling-export.js";

export interface ReactPerfHarness {
  start: () => void;
  stop: () => Promise<ReactProfilerDataExport | null>;
}

declare global {
  interface Window {
    __REACT_PERF__?: ReactPerfHarness;
  }
}

/**
 * Wires the DevTools backend + headless Store + a profiling session, then
 * exposes `window.__REACT_PERF__` so an automation driver (Playwright `evaluate`,
 * the daemon, or a human) can start/stop a profile and pull the export.
 *
 * `installReactDevtoolsBackend` must already have run before React loaded; this
 * is a no-op if the backend isn't installed in time (React simply won't have
 * connected to the hook).
 */
export const createReactPerfHarness = (targetWindow: Window = window): ReactPerfHarness => {
  installReactDevtoolsBackend(targetWindow);
  const store = createProfilerStore(targetWindow);
  const session = createProfilingSession(store);

  const harness: ReactPerfHarness = {
    start: session.start,
    stop: session.stop,
  };

  targetWindow.__REACT_PERF__ = harness;
  return harness;
};
