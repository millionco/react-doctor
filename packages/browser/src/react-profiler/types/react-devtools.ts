import type { ReactProfilerRootDataBackend } from "./profiling-export.js";

export type DevtoolsGlobal = typeof globalThis;

// The subset of React DevTools' RendererInterface we drive directly, bypassing
// the frontend Store/bridge/wall. `getDisplayNameForElementID` is absent on
// older React.
export interface ReactRendererInterface {
  startProfiling: (recordChangeDescriptions: boolean) => void;
  stopProfiling: () => void;
  getProfilingData: () => { dataForRoots: Array<ReactProfilerRootDataBackend> };
  getDisplayNameForElementID?: (id: number) => string | null;
}

export interface ReactDevtoolsHook {
  rendererInterfaces?: Map<number, ReactRendererInterface>;
}

declare global {
  // eslint-disable-next-line no-var, vars-on-top
  var __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevtoolsHook | undefined;
}
