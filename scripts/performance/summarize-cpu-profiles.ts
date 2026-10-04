import { PERCENT_MULTIPLIER, RESULTS_TOP_FRAME_COUNT } from "./constants.ts";
import { analyzeCpuProfileDirectory, toCpuProfileFrameSummaries } from "./analyze-cpu-profile.ts";
import type { AnalyzedCpuProfile } from "./analyze-cpu-profile.ts";
import { aggregateFrameValues } from "./profile-frames.ts";
import type { CpuProfileSourceSummary, CpuProfileSummary, V8ProfileCallFrame } from "./types.ts";

const NODE_MODULES_SEGMENT = "node_modules/";
const SHORT_URL_SEGMENT_COUNT = 3;

export const classifyProfileSource = (callFrame: V8ProfileCallFrame): string => {
  if (callFrame.functionName === "(garbage collector)") return "gc";
  if (callFrame.functionName === "(program)" || callFrame.functionName === "(idle)") {
    return callFrame.functionName.slice(1, -1);
  }
  if (callFrame.url.includes("oxlint-plugin-react-doctor")) return "plugin bundle";
  if (callFrame.url.includes("/oxlint/") || callFrame.url.includes("oxlint/dist")) return "oxlint";
  if (callFrame.url.startsWith("node:")) return "node internals";
  if (callFrame.url.length === 0) return "native";
  return "other";
};

export const shortenProfileUrl = (url: string): string => {
  if (url.length === 0) return "(native)";
  const withoutScheme = url.replace(/^file:\/\//, "");
  const nodeModulesIndex = withoutScheme.lastIndexOf(NODE_MODULES_SEGMENT);
  if (nodeModulesIndex !== -1) {
    return withoutScheme.slice(nodeModulesIndex + NODE_MODULES_SEGMENT.length);
  }
  return withoutScheme.split("/").slice(-SHORT_URL_SEGMENT_COUNT).join("/");
};

const rankSources = (
  selfByKey: Map<string, { selfMicroseconds: number; frameCount: number }>,
  sampledMicroseconds: number,
): CpuProfileSourceSummary[] =>
  [...selfByKey.entries()]
    .map(([source, value]) => ({
      source,
      selfMicroseconds: value.selfMicroseconds,
      selfPercent:
        sampledMicroseconds === 0
          ? 0
          : (value.selfMicroseconds / sampledMicroseconds) * PERCENT_MULTIPLIER,
      frameCount: value.frameCount,
    }))
    .toSorted((left, right) => right.selfMicroseconds - left.selfMicroseconds);

export const summarizeCpuProfileFrames = (
  profiles: readonly AnalyzedCpuProfile[],
): CpuProfileSummary => {
  const sampledMicroseconds = profiles.reduce(
    (total, profile) => total + profile.processSummary.sampledMicroseconds,
    0,
  );
  const aggregateTimings = aggregateFrameValues(profiles.map((profile) => profile.timings));
  const selfBySource = new Map<string, { selfMicroseconds: number; frameCount: number }>();
  const selfByCategory = new Map<string, { selfMicroseconds: number; frameCount: number }>();
  for (const frame of aggregateTimings.values()) {
    for (const [bucketMap, key] of [
      [selfBySource, shortenProfileUrl(frame.callFrame.url)],
      [selfByCategory, classifyProfileSource(frame.callFrame)],
    ] as const) {
      const bucket = bucketMap.get(key) ?? { selfMicroseconds: 0, frameCount: 0 };
      bucket.selfMicroseconds += frame.self;
      bucket.frameCount += 1;
      bucketMap.set(key, bucket);
    }
  }
  return {
    processCount: profiles.length,
    sampledMicroseconds,
    categories: rankSources(selfByCategory, sampledMicroseconds),
    functions: toCpuProfileFrameSummaries(aggregateTimings, sampledMicroseconds).slice(
      0,
      RESULTS_TOP_FRAME_COUNT,
    ),
    sources: rankSources(selfBySource, sampledMicroseconds).slice(0, RESULTS_TOP_FRAME_COUNT),
  };
};

export const summarizeChildCpuProfiles = (profileDirectory: string): CpuProfileSummary | null => {
  const childProfiles = analyzeCpuProfileDirectory(profileDirectory).filter(
    (profile) => profile.processSummary.role !== "react-doctor",
  );
  return childProfiles.length === 0 ? null : summarizeCpuProfileFrames(childProfiles);
};
