import type { ReactProfilerChangeDescription } from "./profiling-export.js";

export interface ReactProfilerSerializedElementBackend {
  displayName: string | null;
  id: number;
  key: number | string | null;
  type: number;
}

export interface ReactProfilerCommitDataBackend {
  changeDescriptions: Array<[number, ReactProfilerChangeDescription]> | null;
  duration: number;
  effectDuration: number | null;
  fiberActualDurations: Array<[number, number]>;
  fiberSelfDurations: Array<[number, number]>;
  passiveEffectDuration: number | null;
  priorityLevel: string | null;
  timestamp: number;
  updaters: Array<ReactProfilerSerializedElementBackend> | null;
}

export interface ReactProfilerDataForRootBackend {
  commitData: Array<ReactProfilerCommitDataBackend>;
  displayName: string;
  initialTreeBaseDurations: Array<[number, number]>;
  rootID: number;
}

/**
 * What the DevTools renderer interface returns from `getProfilingData()` over
 * the bridge. On the web the DevTools Store merges this with its own tree
 * snapshots; on React Native we assemble the export from this plus the
 * operations we observe on the wall.
 */
export interface ReactProfilerDataBackend {
  dataForRoots: Array<ReactProfilerDataForRootBackend>;
  rendererID: number;
}
