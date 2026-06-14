import { PROFILING_EXPORT_VERSION } from "../constants.js";
import type {
  ReactProfilerCommitDataExport,
  ReactProfilerDataExport,
  ReactProfilerDataForRootExport,
} from "../types/profiling-export.js";
import type {
  ReactProfilerCommitDataFrontend,
  ReactProfilerDataForRootFrontend,
  ReactProfilerDataFrontend,
} from "../types/profiling-frontend.js";

const serializeCommitData = (
  commitData: ReactProfilerCommitDataFrontend,
): ReactProfilerCommitDataExport => ({
  changeDescriptions:
    commitData.changeDescriptions === null
      ? null
      : Array.from(commitData.changeDescriptions.entries()),
  duration: commitData.duration,
  effectDuration: commitData.effectDuration,
  fiberActualDurations: Array.from(commitData.fiberActualDurations.entries()),
  fiberSelfDurations: Array.from(commitData.fiberSelfDurations.entries()),
  passiveEffectDuration: commitData.passiveEffectDuration,
  priorityLevel: commitData.priorityLevel,
  timestamp: commitData.timestamp,
  updaters: commitData.updaters,
});

const serializeDataForRoot = (
  dataForRoot: ReactProfilerDataForRootFrontend,
): ReactProfilerDataForRootExport => ({
  commitData: dataForRoot.commitData.map(serializeCommitData),
  displayName: dataForRoot.displayName,
  initialTreeBaseDurations: Array.from(dataForRoot.initialTreeBaseDurations.entries()),
  operations: dataForRoot.operations,
  rootID: dataForRoot.rootID,
  snapshots: Array.from(dataForRoot.snapshots.entries()),
});

/**
 * Mirrors DevTools' internal `prepareProfilingDataExport`: turns the Map-backed
 * in-memory profiling data into the tuple-array `version: 5` export.
 */
export const serializeProfilingExport = (
  profilingData: ReactProfilerDataFrontend,
): ReactProfilerDataExport => ({
  version: PROFILING_EXPORT_VERSION,
  dataForRoots: Array.from(profilingData.dataForRoots.values()).map(serializeDataForRoot),
});
