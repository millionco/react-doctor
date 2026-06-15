import type {
  ReactProfilerChangeDescription,
  ReactProfilerSerializedElement,
  ReactProfilerSnapshotNode,
} from "./profiling-export.js";

export interface ReactProfilerCommitDataFrontend {
  changeDescriptions: Map<number, ReactProfilerChangeDescription> | null;
  duration: number;
  effectDuration: number | null;
  fiberActualDurations: Map<number, number>;
  fiberSelfDurations: Map<number, number>;
  passiveEffectDuration: number | null;
  priorityLevel: string | null;
  timestamp: number;
  updaters: Array<ReactProfilerSerializedElement> | null;
}

export interface ReactProfilerDataForRootFrontend {
  commitData: Array<ReactProfilerCommitDataFrontend>;
  displayName: string;
  initialTreeBaseDurations: Map<number, number>;
  operations: Array<Array<number>>;
  rootID: number;
  snapshots: Map<number, ReactProfilerSnapshotNode>;
}

/**
 * The in-memory shape DevTools' `ProfilerStore.profilingData` exposes after a
 * session completes (Maps, not serialized tuples). We convert it to
 * `ReactProfilerDataExport` ourselves because the DevTools converter lives in
 * the unpublished `react-devtools-shared` internal package.
 */
export interface ReactProfilerDataFrontend {
  dataForRoots: Map<number, ReactProfilerDataForRootFrontend>;
  timelineData: Array<unknown>;
  imported: boolean;
}
