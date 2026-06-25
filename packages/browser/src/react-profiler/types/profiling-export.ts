import type { PROFILING_EXPORT_VERSION } from "../devtools/collect-profiling-export.js";

export interface ReactProfilerChangeDescription {
  context: Array<string> | boolean | null;
  didHooksChange: boolean;
  isFirstMount: boolean;
  props: Array<string> | null;
  state: Array<string> | null;
  hooks?: Array<number> | null;
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

// One profiled root, exactly as the renderer's `getProfilingData` returns it.
export interface ReactProfilerRootDataBackend {
  rootID: number;
  displayName: string;
  commitData: Array<ReactProfilerCommitDataExport>;
  initialTreeBaseDurations: Array<[number, number]>;
}

// The renderer's per-root data plus `elementNames`, the `fiberID → component
// name` map an agent needs to read the durations and change descriptions
// (which key everything by fiber id).
export interface ReactProfilerDataForRootExport extends ReactProfilerRootDataBackend {
  elementNames: Array<[number, string]>;
}

export interface ReactProfilerDataExport {
  version: typeof PROFILING_EXPORT_VERSION;
  dataForRoots: Array<ReactProfilerDataForRootExport>;
}
