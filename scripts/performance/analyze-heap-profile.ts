import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BYTES_PER_MEBIBYTE, PROFILE_TOP_FRAME_COUNT } from "./constants.ts";
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
  HeapProfile,
  HeapProfileAnalysis,
  HeapProfileFrameSummary,
  HeapProfileNode,
  HeapProfileProcessSummary,
} from "./types.ts";

interface AnalyzedHeapProfile {
  processSummary: HeapProfileProcessSummary;
  allocations: Map<string, MutableFrameValue>;
}

const isHeapProfileNode = (value: unknown): value is HeapProfileNode =>
  isRecordWithFields(value, { selfSize: "number", id: "number" }) &&
  isCallFrame(value.callFrame) &&
  Array.isArray(value.children) &&
  value.children.every(isHeapProfileNode);

const isHeapProfile = (value: unknown): value is HeapProfile =>
  isRecord(value) && isHeapProfileNode(value.head);

// JSON.parse output is always a strict tree, but guard against cyclic or
// shared nodes anyway so a synthetic graph is rejected like the CPU path
// instead of looping forever.
const collectNodes = (rootNode: HeapProfileNode, profilePath: string): HeapProfileNode[] => {
  const nodes: HeapProfileNode[] = [];
  const visitedNodes = new Set<HeapProfileNode>();
  const pendingNodes = [rootNode];
  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop();
    if (node === undefined) continue;
    if (visitedNodes.has(node)) {
      throw new Error(`Invalid heap profile with cyclic nodes: ${profilePath}`);
    }
    visitedNodes.add(node);
    nodes.push(node);
    pendingNodes.push(...node.children);
  }
  return nodes;
};

const toFrameSummaries = (
  allocations: Map<string, MutableFrameValue>,
  sampledBytes: number,
): HeapProfileFrameSummary[] =>
  toRankedFrames(allocations, sampledBytes).map(({ self, total, ...frame }) => ({
    ...frame,
    selfBytes: self,
    totalBytes: total,
  }));

const analyzeProfile = (profilePath: string): AnalyzedHeapProfile => {
  const parsedProfile: unknown = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  if (!isHeapProfile(parsedProfile)) throw new Error(`Invalid heap profile: ${profilePath}`);
  const nodes = collectNodes(parsedProfile.head, profilePath);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  if (nodesById.size !== nodes.length) {
    throw new Error(`Invalid heap profile with duplicate node IDs: ${profilePath}`);
  }
  const frameKeysByNodeId = new Map(
    nodes.map((node) => [node.id, profileFrameKey(node.callFrame)]),
  );
  const parentById = new Map<number, number>();
  for (const node of nodes) {
    for (const child of node.children) {
      const existingParentId = parentById.get(child.id);
      if (existingParentId !== undefined && existingParentId !== node.id) {
        throw new Error(`Invalid heap profile with multiple parents: ${profilePath}`);
      }
      parentById.set(child.id, node.id);
    }
  }
  const allocations = new Map<string, MutableFrameValue>();
  let sampledBytes = 0;
  for (const node of nodes) {
    if (node.selfSize <= 0) continue;
    sampledBytes += node.selfSize;
    const selfKey = frameKeysByNodeId.get(node.id);
    if (selfKey === undefined) continue;
    getFrameValue(allocations, selfKey, node.callFrame).self += node.selfSize;
    addFrameChainTotals({
      startNode: node,
      amount: node.selfSize,
      nodesById,
      parentById,
      frameKeysByNodeId,
      frames: allocations,
      profilePath,
    });
  }
  return {
    processSummary: {
      file: profilePath,
      role: resolveProfileProcessRole(nodes.map((node) => node.callFrame)),
      sampledBytes,
      topFrames: toFrameSummaries(allocations, sampledBytes).slice(0, PROFILE_TOP_FRAME_COUNT),
    },
    allocations,
  };
};

const renderAnalysisMarkdown = (analysis: HeapProfileAnalysis): string => {
  const lines = [
    "# V8 heap profile analysis",
    "",
    `Profiles: ${analysis.processes.length}`,
    `Sampled allocations: ${(analysis.sampledBytes / BYTES_PER_MEBIBYTE).toFixed(2)} MiB`,
    "",
    "## Aggregate sampled allocations",
    "",
    "| Function | Source | Self | Total |",
    "| --- | --- | ---: | ---: |",
  ];
  for (const frame of analysis.aggregateTopFrames) {
    const source = frame.url ? `${frame.url}:${frame.lineNumber}` : "(native)";
    lines.push(
      `| ${frame.functionName.replaceAll("|", "\\|")} | ${source.replaceAll("|", "\\|")} | ${(frame.selfBytes / BYTES_PER_MEBIBYTE).toFixed(2)} MiB (${frame.selfPercent.toFixed(2)}%) | ${(frame.totalBytes / BYTES_PER_MEBIBYTE).toFixed(2)} MiB (${frame.totalPercent.toFixed(2)}%) |`,
    );
  }
  lines.push("", "## Processes", "");
  for (const processSummary of analysis.processes) {
    lines.push(
      `- ${processSummary.role}: ${(processSummary.sampledBytes / BYTES_PER_MEBIBYTE).toFixed(2)} MiB — ${path.basename(processSummary.file)}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

export const analyzeHeapProfiles = (profileDirectory: string): HeapProfileAnalysis => {
  const analyzedProfiles = collectProfilePaths({
    directory: profileDirectory,
    extension: ".heapprofile",
  }).map(analyzeProfile);
  if (analyzedProfiles.length === 0) {
    throw new Error(`No .heapprofile files found in ${profileDirectory}`);
  }
  const sampledBytes = analyzedProfiles.reduce(
    (total, analyzedProfile) => total + analyzedProfile.processSummary.sampledBytes,
    0,
  );
  const aggregateAllocations = aggregateFrameValues(
    analyzedProfiles.map((analyzedProfile) => analyzedProfile.allocations),
  );
  return {
    generatedAt: new Date().toISOString(),
    profileDirectory,
    sampledBytes,
    processes: analyzedProfiles.map((analyzedProfile) => analyzedProfile.processSummary),
    aggregateTopFrames: toFrameSummaries(aggregateAllocations, sampledBytes).slice(
      0,
      PROFILE_TOP_FRAME_COUNT,
    ),
  };
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runProfileAnalysisMain({
    name: "react-doctor-performance-memory",
    description: "Aggregate V8 heap profiles captured by the performance harness",
    defaultOutputName: "memory",
    analyze: analyzeHeapProfiles,
    renderMarkdown: renderAnalysisMarkdown,
  });
}
