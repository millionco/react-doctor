import type { ReactProfilerDataExport } from "../types/profiling-export.js";
import type { DevtoolsGlobal, ReactDevtoolsStore } from "../types/react-devtools.js";
import { createProfilingSession } from "./profiling-session.js";
import { installReactDevtoolsBackend } from "./install-backend.js";

export interface ReactPerfHarness {
  start: () => void;
  stop: () => Promise<ReactProfilerDataExport | null>;
}

declare global {
  interface Window {
    __REACT_PERF__?: ReactPerfHarness;
  }
  // React Native exposes `global`, not `window`.
  // eslint-disable-next-line vars-on-top, no-var
  var __REACT_PERF__: ReactPerfHarness | undefined;
}

/**
 * Wires the DevTools backend + a profiler store + a profiling session, then
 * exposes `__REACT_PERF__` on the target global. The store factory is the only
 * platform-specific piece (web frontend Store vs. the RN backend collector).
 */
export const makeReactPerfHarness = (
  createProfilerStore: (target: DevtoolsGlobal) => ReactDevtoolsStore,
  target: DevtoolsGlobal,
): ReactPerfHarness => {
  installReactDevtoolsBackend(target);
  const store = createProfilerStore(target);
  const session = createProfilingSession(store);
  const harness: ReactPerfHarness = { start: session.start, stop: session.stop };
  target.__REACT_PERF__ = harness;
  return harness;
};
