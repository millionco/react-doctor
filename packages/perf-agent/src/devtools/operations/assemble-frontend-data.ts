import type {
  ReactProfilerCommitDataBackend,
  ReactProfilerDataBackend,
} from "../../types/profiling-backend.js";
import type {
  ReactProfilerSerializedElement,
  ReactProfilerSnapshotNode,
} from "../../types/profiling-export.js";
import type {
  ReactProfilerCommitDataFrontend,
  ReactProfilerDataForRootFrontend,
  ReactProfilerDataFrontend,
} from "../../types/profiling-frontend.js";
import { parseElementDisplayName } from "../../utils/parse-element-display-name.js";

export interface AssembleFrontendDataInput {
  dataBackend: ReactProfilerDataBackend;
  operationsByRootID: Map<number, Array<Array<number>>>;
  snapshotsByRootID: Map<number, Map<number, ReactProfilerSnapshotNode>>;
}

const convertCommitData = (
  commit: ReactProfilerCommitDataBackend,
): ReactProfilerCommitDataFrontend => ({
  changeDescriptions:
    commit.changeDescriptions === null ? null : new Map(commit.changeDescriptions),
  duration: commit.duration,
  effectDuration: commit.effectDuration,
  fiberActualDurations: new Map(commit.fiberActualDurations),
  fiberSelfDurations: new Map(commit.fiberSelfDurations),
  passiveEffectDuration: commit.passiveEffectDuration,
  priorityLevel: commit.priorityLevel,
  timestamp: commit.timestamp,
  updaters:
    commit.updaters === null
      ? null
      : commit.updaters.map(
          (element): ReactProfilerSerializedElement => ({
            displayName: parseElementDisplayName(element.displayName, element.type)
              .formattedDisplayName,
            id: element.id,
            key: element.key,
            type: element.type,
          }),
        ),
});

/**
 * Port of React DevTools' `prepareProfilingDataFrontendFromBackendAndStore`
 * (timeline omitted): merges the backend's per-commit timings with the
 * operations + snapshots we observed on the wall into the frontend-shaped data
 * that `serializeProfilingExport` turns into the canonical v5 export.
 */
export const assembleFrontendData = ({
  dataBackend,
  operationsByRootID,
  snapshotsByRootID,
}: AssembleFrontendDataInput): ReactProfilerDataFrontend => {
  const dataForRoots = new Map<number, ReactProfilerDataForRootFrontend>();
  for (const root of dataBackend.dataForRoots) {
    dataForRoots.set(root.rootID, {
      commitData: root.commitData.map(convertCommitData),
      displayName: root.displayName,
      initialTreeBaseDurations: new Map(root.initialTreeBaseDurations),
      operations: operationsByRootID.get(root.rootID) ?? [],
      rootID: root.rootID,
      snapshots: snapshotsByRootID.get(root.rootID) ?? new Map(),
    });
  }
  return { dataForRoots, timelineData: [], imported: false };
};
