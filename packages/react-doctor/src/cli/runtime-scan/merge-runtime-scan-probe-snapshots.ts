import {
  RUNTIME_SCAN_MAX_COMPONENT_EVENTS,
  RUNTIME_SCAN_MAX_INTERACTIONS,
  RUNTIME_SCAN_MAX_LOAF_ENTRIES,
} from "./constants.js";
import type {
  RuntimeScanComponentEvent,
  RuntimeScanInteraction,
  RuntimeScanLongAnimationFrame,
  RuntimeScanProbeSnapshot,
} from "./types.js";

interface RuntimeScanTimestampedEntry {
  readonly startTime: number;
}

const shiftOptionalTimestamp = (timestamp: number, offset: number): number =>
  timestamp === 0 ? 0 : timestamp + offset;

const takeLatestEntries = <Entry extends RuntimeScanTimestampedEntry>(
  entries: ReadonlyArray<Entry>,
  limit: number,
): ReadonlyArray<Entry> =>
  [...entries].sort((left, right) => left.startTime - right.startTime).slice(-limit);

const shiftLongAnimationFrame = (
  frame: RuntimeScanLongAnimationFrame,
  offset: number,
): RuntimeScanLongAnimationFrame => ({
  ...frame,
  startTime: frame.startTime + offset,
  renderStart: shiftOptionalTimestamp(frame.renderStart, offset),
  styleAndLayoutStart: shiftOptionalTimestamp(frame.styleAndLayoutStart, offset),
  firstUiEventTimestamp: shiftOptionalTimestamp(frame.firstUiEventTimestamp, offset),
  scripts: frame.scripts.map((script) => ({
    ...script,
    executionStart: shiftOptionalTimestamp(script.executionStart, offset),
  })),
});

const shiftComponentEvent = (
  componentEvent: RuntimeScanComponentEvent,
  offset: number,
): RuntimeScanComponentEvent => ({
  ...componentEvent,
  startTime: componentEvent.startTime + offset,
});

const shiftInteraction = (
  interaction: RuntimeScanInteraction,
  offset: number,
  documentIndex: number,
): RuntimeScanInteraction => ({
  ...interaction,
  startTime: interaction.startTime + offset,
  processingStart: interaction.processingStart + offset,
  processingEnd: interaction.processingEnd + offset,
  documentIndex,
});

export const mergeRuntimeScanProbeSnapshots = (
  capturedSnapshots: ReadonlyArray<RuntimeScanProbeSnapshot>,
): RuntimeScanProbeSnapshot => {
  const snapshotsByTimeOrigin = new Map<number, RuntimeScanProbeSnapshot>();
  for (const snapshot of capturedSnapshots) {
    snapshotsByTimeOrigin.delete(snapshot.timeOrigin);
    snapshotsByTimeOrigin.set(snapshot.timeOrigin, snapshot);
  }
  const snapshots = [...snapshotsByTimeOrigin.values()];
  const finalSnapshot = snapshots.at(-1);
  if (finalSnapshot === undefined) {
    throw new Error("At least one runtime scan probe snapshot is required.");
  }
  const timeOrigin = Math.min(...snapshots.map((snapshot) => snapshot.timeOrigin));
  const documentIndexByTimeOrigin = new Map<number, number>();
  const snapshotsInCreationOrder = [...snapshots].sort(
    (left, right) => left.timeOrigin - right.timeOrigin,
  );
  for (const [documentIndex, snapshot] of snapshotsInCreationOrder.entries()) {
    documentIndexByTimeOrigin.set(snapshot.timeOrigin, documentIndex);
  }

  const longAnimationFrames = snapshots.flatMap((snapshot) => {
    const offset = snapshot.timeOrigin - timeOrigin;
    return snapshot.longAnimationFrames.map((frame) => shiftLongAnimationFrame(frame, offset));
  });
  const componentEvents = snapshots.flatMap((snapshot) => {
    const offset = snapshot.timeOrigin - timeOrigin;
    return snapshot.componentEvents.map((componentEvent) =>
      shiftComponentEvent(componentEvent, offset),
    );
  });
  const interactions = snapshots.flatMap((snapshot) => {
    const offset = snapshot.timeOrigin - timeOrigin;
    const documentIndex = documentIndexByTimeOrigin.get(snapshot.timeOrigin) ?? 0;
    return snapshot.interactions.map((interaction) =>
      shiftInteraction(interaction, offset, documentIndex),
    );
  });
  const latestReactSnapshot = [...snapshots]
    .reverse()
    .find((snapshot) => snapshot.support.reactDetected);

  return {
    timeOrigin,
    finalUrl: finalSnapshot.finalUrl,
    support: {
      reactDetected: snapshots.some((snapshot) => snapshot.support.reactDetected),
      reactVersion: latestReactSnapshot?.support.reactVersion ?? null,
      reactBuildType: latestReactSnapshot?.support.reactBuildType ?? null,
      nativeReactTracks: snapshots.some((snapshot) => snapshot.support.nativeReactTracks),
      bippyComponentTracks: snapshots.some((snapshot) => snapshot.support.bippyComponentTracks),
      loaf: snapshots.some((snapshot) => snapshot.support.loaf),
    },
    longAnimationFrames: takeLatestEntries(longAnimationFrames, RUNTIME_SCAN_MAX_LOAF_ENTRIES),
    componentEvents: takeLatestEntries(componentEvents, RUNTIME_SCAN_MAX_COMPONENT_EVENTS),
    interactions: takeLatestEntries(interactions, RUNTIME_SCAN_MAX_INTERACTIONS),
    cumulativeLayoutShift: Math.max(...snapshots.map((snapshot) => snapshot.cumulativeLayoutShift)),
    largestContentfulPaintMs: finalSnapshot.largestContentfulPaintMs,
    droppedLongAnimationFrames:
      snapshots.reduce((total, snapshot) => total + snapshot.droppedLongAnimationFrames, 0) +
      Math.max(0, longAnimationFrames.length - RUNTIME_SCAN_MAX_LOAF_ENTRIES),
    droppedScriptTimings: snapshots.reduce(
      (total, snapshot) => total + snapshot.droppedScriptTimings,
      0,
    ),
    droppedComponentEvents:
      snapshots.reduce((total, snapshot) => total + snapshot.droppedComponentEvents, 0) +
      Math.max(0, componentEvents.length - RUNTIME_SCAN_MAX_COMPONENT_EVENTS),
    droppedInteractions:
      snapshots.reduce((total, snapshot) => total + snapshot.droppedInteractions, 0) +
      Math.max(0, interactions.length - RUNTIME_SCAN_MAX_INTERACTIONS),
  };
};
