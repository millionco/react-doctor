import { collectProfilingExport } from "./devtools/collect-profiling-export.js";
import { installReactDevtoolsBackend } from "./devtools/install-backend.js";
import type { ReactProfilerDataExport } from "./types/profiling-export.js";
import type { DevtoolsGlobal } from "./types/react-devtools.js";

export interface ReactPerfHarness {
  start: () => void;
  stop: () => Promise<ReactProfilerDataExport | null>;
}

declare global {
  // eslint-disable-next-line no-var, vars-on-top
  var __REACT_PERF__: ReactPerfHarness | undefined;
}

export const createReactPerfHarness = (target: DevtoolsGlobal = globalThis): ReactPerfHarness => {
  installReactDevtoolsBackend(target);

  const harness: ReactPerfHarness = {
    start: () => {
      const renderers = target.__REACT_DEVTOOLS_GLOBAL_HOOK__?.rendererInterfaces;
      if (!renderers) return;
      for (const renderer of renderers.values()) renderer.startProfiling(true);
    },
    stop: () => Promise.resolve(collectProfilingExport(target)),
  };

  target.__REACT_PERF__ = harness;
  return harness;
};
