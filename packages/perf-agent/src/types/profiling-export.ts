export interface ReactProfilerChangeDescription {
  context: Array<string> | boolean | null;
  didHooksChange: boolean;
  isFirstMount: boolean;
  props: Array<string> | null;
  state: Array<string> | null;
  hooks?: Array<number> | null;
}

export interface ReactProfilerSnapshotNode {
  id: number;
  children: Array<number>;
  displayName: string | null;
  hocDisplayNames: Array<string> | null;
  key: number | string | null;
  type: number;
  compiledWithForget: boolean;
}

export interface ReactProfilerSerializedElement {
  displayName: string | null;
  id: number;
  key: number | string | null;
  type: number;
}

export interface ReactProfilerCommitDataExport {
  changeDescriptions: Array<[number, ReactProfilerChangeDescription]> | null;
  duration: number;
  effectDuration: number | null;
  fiberActualDurations: Array<[number, number]>;
  fiberSelfDurations: Array<[number, number]>;
  passiveEffectDuration: number | null;
  priorityLevel: string | null;
  timestamp: number;
  updaters: Array<ReactProfilerSerializedElement> | null;
}

export interface ReactProfilerDataForRootExport {
  commitData: Array<ReactProfilerCommitDataExport>;
  displayName: string;
  initialTreeBaseDurations: Array<[number, number]>;
  operations: Array<Array<number>>;
  rootID: number;
  snapshots: Array<[number, ReactProfilerSnapshotNode]>;
}

/**
 * Byte-compatible with React DevTools' `ProfilingDataExport`. A file shaped
 * like this re-imports into the DevTools Profiler UI and feeds the existing
 * "analyze the profiler JSON" scripts unchanged. `timelineData` is omitted
 * here (valid per the v5 schema: "old exported profiles won't contain this
 * key") and is a follow-up.
 */
export interface ReactProfilerDataExport {
  version: 5;
  dataForRoots: Array<ReactProfilerDataForRootExport>;
  timelineData?: Array<unknown>;
}
