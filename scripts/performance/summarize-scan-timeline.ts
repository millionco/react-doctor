import * as path from "node:path";
import { MICROSECONDS_PER_SECOND } from "./constants.ts";
import { summarizeDistribution } from "./summarize-distribution.ts";
import type { OxlintSpawnChildRecord, ScanTimeline, SummarizeScanTimelineInput } from "./types.ts";

const isFailedChild = (child: OxlintSpawnChildRecord): boolean =>
  child.signal !== null ||
  child.stdoutBytes === 0 ||
  !child.stdoutPreview.trimStart().startsWith("{");

const computePeakConcurrency = (children: readonly OxlintSpawnChildRecord[]): number => {
  const events = children
    .flatMap((child) => [
      { at: child.startedAt, delta: 1 },
      { at: child.endedAt, delta: -1 },
    ])
    .toSorted((left, right) => left.at - right.at || left.delta - right.delta);
  let activeCount = 0;
  let peakCount = 0;
  for (const event of events) {
    activeCount += event.delta;
    peakCount = Math.max(peakCount, activeCount);
  }
  return peakCount;
};

export const summarizeScanTimeline = (input: SummarizeScanTimelineInput): ScanTimeline => {
  const { children, parent } = input.spawnLog;
  const wallMilliseconds = input.scanEndedAt - input.scanStartedAt;
  const durations = children.map((child) => child.endedAt - child.startedAt);
  const childDurationSumMilliseconds = durations.reduce((total, duration) => total + duration, 0);
  const firstChildStart =
    children.length === 0 ? null : Math.min(...children.map((child) => child.startedAt));
  const lastChildEnd =
    children.length === 0 ? null : Math.max(...children.map((child) => child.endedAt));
  const childSpanMilliseconds =
    firstChildStart === null || lastChildEnd === null ? 0 : lastChildEnd - firstChildStart;
  const durationSummary = durations.length === 0 ? null : summarizeDistribution(durations);
  return {
    wallMilliseconds,
    childProcessCount: children.length,
    failedChildProcessCount: children.filter(isFailedChild).length,
    configCount: new Set(
      children.flatMap((child) =>
        child.configPath === null ? [] : [path.dirname(child.configPath)],
      ),
    ).size,
    childFileCount: children.reduce((total, child) => total + child.fileCount, 0),
    childDurationSumMilliseconds,
    childDurationMedianMilliseconds: durationSummary?.median ?? 0,
    childDurationMaximumMilliseconds: durationSummary?.maximum ?? 0,
    childSpanMilliseconds,
    averageConcurrency:
      childSpanMilliseconds === 0 ? 0 : childDurationSumMilliseconds / childSpanMilliseconds,
    peakConcurrency: computePeakConcurrency(children),
    headMilliseconds:
      firstChildStart === null ? wallMilliseconds : firstChildStart - input.scanStartedAt,
    tailMilliseconds: lastChildEnd === null ? 0 : input.scanEndedAt - lastChildEnd,
    parentUserSeconds: parent === null ? null : parent.userMicroseconds / MICROSECONDS_PER_SECOND,
    parentSystemSeconds:
      parent === null ? null : parent.systemMicroseconds / MICROSECONDS_PER_SECOND,
  };
};
