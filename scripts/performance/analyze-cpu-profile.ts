import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { MICROSECONDS_PER_SECOND, PROFILE_TOP_FRAME_COUNT } from "./constants.ts";
import { isRecord, isRecordWithFields } from "./is-record-with-fields.ts";
import {
  addFrameChainTotals,
  collectProfilePaths,
  aggregateFrameValues,
  getFrameValue,
  isCallFrame,
  profileFrameKey,
  resolveProfileProcessRole,
  toRankedFrames,
} from "./profile-frames.ts";
import type { MutableFrameValue } from "./profile-frames.ts";
import { runProfileAnalysisMain } from "./run-commander-main.ts";
import type {
  CpuProfile,
  CpuProfileAnalysis,
  CpuProfileFrameSummary,
  CpuProfileNode,
  CpuProfileProcessSummary,
} from "./types.ts";

interface AnalyzedProfile {
  processSummary: CpuProfileProcessSummary;
  timings: Map<string, MutableFrameValue>;
}

const isCpuProfileNode = (value: unknown): value is CpuProfileNode =>
  isRecordWithFields(value, { id: "number" }) &&
  isCallFrame(value.callFrame) &&
  (!("children" in value) ||
    (Array.isArray(value.children) &&
      value.children.every((childId) => typeof childId === "number")));

const isCpuProfile = (value: unknown): value is CpuProfile =>
  isRecord(value) &&
  Array.isArray(value.nodes) &&
  value.nodes.every(isCpuProfileNode) &&
  (!("samples" in value) ||
    (Array.isArray(value.samples) &&
      value.samples.every((sample) => typeof sample === "number"))) &&
  (!("timeDeltas" in value) ||
    (Array.isArray(value.timeDeltas) &&
      value.timeDeltas.every((delta) => typeof delta === "number")));

const toFrameSummaries = (
  timings: Map<string, MutableFrameValue>,
  sampledMicroseconds: number,
): CpuProfileFrameSummary[] =>
  toRankedFrames(timings, sampledMicroseconds).map(({ self, total, ...frame }) => ({
    ...frame,
    selfMicroseconds: self,
    totalMicroseconds: total,
  }));

const analyzeProfile = (profilePath: string): AnalyzedProfile => {
  const parsedProfile: unknown = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  if (!isCpuProfile(parsedProfile)) throw new Error(`Invalid CPU profile: ${profilePath}`);
  const nodesById = new Map(parsedProfile.nodes.map((node) => [node.id, node]));
  if (nodesById.size !== parsedProfile.nodes.length) {
    throw new Error(`Invalid CPU profile with duplicate node IDs: ${profilePath}`);
  }
  const frameKeysByNodeId = new Map(
    parsedProfile.nodes.map((node) => [node.id, profileFrameKey(node.callFrame)]),
  );
  const parentById = new Map<number, number>();
  for (const node of parsedProfile.nodes) {
    for (const childId of node.children ?? []) {
      if (!nodesById.has(childId)) {
        throw new Error(`Invalid CPU profile with unknown child node: ${profilePath}`);
      }
      const existingParentId = parentById.get(childId);
      if (existingParentId !== undefined && existingParentId !== node.id) {
        throw new Error(`Invalid CPU profile with multiple parents: ${profilePath}`);
      }
      parentById.set(childId, node.id);
    }
  }
  const timings = new Map<string, MutableFrameValue>();
  let sampledMicroseconds = 0;
  const samples = parsedProfile.samples ?? [];
  const timeDeltas = parsedProfile.timeDeltas ?? [];
  for (let index = 0; index < samples.length; index += 1) {
    const sampleNode = nodesById.get(samples[index] ?? -1);
    const deltaMicroseconds = timeDeltas[index] ?? 0;
    if (sampleNode === undefined || deltaMicroseconds <= 0) continue;
    sampledMicroseconds += deltaMicroseconds;
    const selfKey = frameKeysByNodeId.get(sampleNode.id);
    if (selfKey === undefined) continue;
    getFrameValue(timings, selfKey, sampleNode.callFrame).self += deltaMicroseconds;
    addFrameChainTotals({
      startNode: sampleNode,
      amount: deltaMicroseconds,
      nodesById,
      parentById,
      frameKeysByNodeId,
      frames: timings,
      profilePath,
    });
  }
  return {
    processSummary: {
      file: profilePath,
      role: resolveProfileProcessRole(parsedProfile.nodes.map((node) => node.callFrame)),
      sampledMicroseconds,
      topFrames: toFrameSummaries(timings, sampledMicroseconds).slice(0, PROFILE_TOP_FRAME_COUNT),
    },
    timings,
  };
};

const renderAnalysisMarkdown = (analysis: CpuProfileAnalysis): string => {
  const lines = [
    "# V8 CPU profile analysis",
    "",
    `Profiles: ${analysis.processes.length}`,
    `Summed profile duration: ${(analysis.sampledMicroseconds / MICROSECONDS_PER_SECOND).toFixed(2)} seconds`,
    "",
    "## Aggregate self time",
    "",
    "| Function | Source | Self | Total |",
    "| --- | --- | ---: | ---: |",
  ];
  for (const frame of analysis.aggregateTopFrames) {
    const source = frame.url ? `${frame.url}:${frame.lineNumber}` : "(native)";
    lines.push(
      `| ${frame.functionName.replaceAll("|", "\\|")} | ${source.replaceAll("|", "\\|")} | ${frame.selfPercent.toFixed(2)}% | ${frame.totalPercent.toFixed(2)}% |`,
    );
  }
  lines.push("", "## Processes", "");
  for (const processSummary of analysis.processes) {
    lines.push(
      `- ${processSummary.role}: ${(processSummary.sampledMicroseconds / MICROSECONDS_PER_SECOND).toFixed(2)}s — ${path.basename(processSummary.file)}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

export const analyzeCpuProfiles = (profileDirectory: string): CpuProfileAnalysis => {
  const analyzedProfiles = collectProfilePaths({
    directory: profileDirectory,
    extension: ".cpuprofile",
  }).map(analyzeProfile);
  if (analyzedProfiles.length === 0) {
    throw new Error(`No .cpuprofile files found in ${profileDirectory}`);
  }
  const sampledMicroseconds = analyzedProfiles.reduce(
    (total, analyzedProfile) => total + analyzedProfile.processSummary.sampledMicroseconds,
    0,
  );
  const aggregateTimings = aggregateFrameValues(
    analyzedProfiles.map((analyzedProfile) => analyzedProfile.timings),
  );
  return {
    generatedAt: new Date().toISOString(),
    profileDirectory,
    sampledMicroseconds,
    processes: analyzedProfiles.map((analyzedProfile) => analyzedProfile.processSummary),
    aggregateTopFrames: toFrameSummaries(aggregateTimings, sampledMicroseconds).slice(
      0,
      PROFILE_TOP_FRAME_COUNT,
    ),
  };
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runProfileAnalysisMain({
    name: "react-doctor-performance-profile",
    description: "Aggregate V8 CPU profiles captured by the performance harness",
    defaultOutputName: "analysis",
    analyze: analyzeCpuProfiles,
    renderMarkdown: renderAnalysisMarkdown,
  });
}
