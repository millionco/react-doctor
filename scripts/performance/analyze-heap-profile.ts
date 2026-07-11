import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { BYTES_PER_MEBIBYTE, PERCENT_MULTIPLIER, PROFILE_TOP_FRAME_COUNT } from "./constants.ts";
import { collectProfilePaths } from "./collect-profile-paths.ts";
import { profileFrameKey } from "./profile-frame-key.ts";
import { resolveProfileProcessRole } from "./resolve-profile-process-role.ts";
import { runCommanderMain } from "./run-commander-main.ts";
import type {
  HeapProfile,
  HeapProfileAnalysis,
  HeapProfileFrameSummary,
  HeapProfileNode,
  HeapProfileProcessSummary,
} from "./types.ts";

interface MutableFrameAllocation {
  callFrame: HeapProfileNode["callFrame"];
  selfBytes: number;
  totalBytes: number;
}

interface AnalyzedHeapProfile {
  processSummary: HeapProfileProcessSummary;
  allocations: Map<string, MutableFrameAllocation>;
}

interface HeapProfileCommandOptions {
  out?: string;
}

const isCallFrame = (value: unknown): value is HeapProfileNode["callFrame"] =>
  typeof value === "object" &&
  value !== null &&
  "functionName" in value &&
  typeof value.functionName === "string" &&
  "url" in value &&
  typeof value.url === "string" &&
  "lineNumber" in value &&
  typeof value.lineNumber === "number" &&
  "columnNumber" in value &&
  typeof value.columnNumber === "number";

const isHeapProfileNode = (value: unknown): value is HeapProfileNode => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "callFrame" in value &&
    isCallFrame(value.callFrame) &&
    "selfSize" in value &&
    typeof value.selfSize === "number" &&
    "id" in value &&
    typeof value.id === "number" &&
    "children" in value &&
    Array.isArray(value.children) &&
    value.children.every(isHeapProfileNode)
  );
};

const isHeapProfile = (value: unknown): value is HeapProfile =>
  typeof value === "object" && value !== null && "head" in value && isHeapProfileNode(value.head);

const collectNodes = (rootNode: HeapProfileNode): HeapProfileNode[] => {
  const nodes: HeapProfileNode[] = [];
  const pendingNodes = [rootNode];
  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop();
    if (node === undefined) continue;
    nodes.push(node);
    pendingNodes.push(...node.children);
  }
  return nodes;
};

const toFrameSummaries = (
  allocations: Map<string, MutableFrameAllocation>,
  sampledBytes: number,
): HeapProfileFrameSummary[] =>
  [...allocations.values()]
    .map((allocation) => ({
      functionName: allocation.callFrame.functionName || "(anonymous)",
      url: allocation.callFrame.url,
      lineNumber: allocation.callFrame.lineNumber + 1,
      selfBytes: allocation.selfBytes,
      totalBytes: allocation.totalBytes,
      selfPercent:
        sampledBytes === 0 ? 0 : (allocation.selfBytes / sampledBytes) * PERCENT_MULTIPLIER,
      totalPercent:
        sampledBytes === 0 ? 0 : (allocation.totalBytes / sampledBytes) * PERCENT_MULTIPLIER,
    }))
    .toSorted(
      (leftFrame, rightFrame) =>
        rightFrame.selfBytes - leftFrame.selfBytes || rightFrame.totalBytes - leftFrame.totalBytes,
    );

const analyzeProfile = (profilePath: string): AnalyzedHeapProfile => {
  const parsedProfile: unknown = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  if (!isHeapProfile(parsedProfile)) throw new Error(`Invalid heap profile: ${profilePath}`);
  const nodes = collectNodes(parsedProfile.head);
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
  const allocations = new Map<string, MutableFrameAllocation>();
  let sampledBytes = 0;
  for (const node of nodes) {
    if (node.selfSize <= 0) continue;
    sampledBytes += node.selfSize;
    const selfKey = frameKeysByNodeId.get(node.id);
    if (selfKey === undefined) continue;
    const selfAllocation = allocations.get(selfKey) ?? {
      callFrame: node.callFrame,
      selfBytes: 0,
      totalBytes: 0,
    };
    selfAllocation.selfBytes += node.selfSize;
    allocations.set(selfKey, selfAllocation);
    const visitedFrameKeys = new Set<string>();
    const visitedNodeIds = new Set<number>();
    let currentNode: HeapProfileNode | undefined = node;
    while (currentNode !== undefined) {
      if (visitedNodeIds.has(currentNode.id)) {
        throw new Error(`Invalid heap profile with cyclic nodes: ${profilePath}`);
      }
      visitedNodeIds.add(currentNode.id);
      const currentFrameKey = frameKeysByNodeId.get(currentNode.id);
      if (currentFrameKey !== undefined && !visitedFrameKeys.has(currentFrameKey)) {
        const allocation = allocations.get(currentFrameKey) ?? {
          callFrame: currentNode.callFrame,
          selfBytes: 0,
          totalBytes: 0,
        };
        allocation.totalBytes += node.selfSize;
        allocations.set(currentFrameKey, allocation);
        visitedFrameKeys.add(currentFrameKey);
      }
      const parentId = parentById.get(currentNode.id);
      currentNode = parentId === undefined ? undefined : nodesById.get(parentId);
    }
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
  const aggregateAllocations = new Map<string, MutableFrameAllocation>();
  for (const analyzedProfile of analyzedProfiles) {
    for (const [key, profileAllocation] of analyzedProfile.allocations) {
      const allocation = aggregateAllocations.get(key) ?? {
        callFrame: profileAllocation.callFrame,
        selfBytes: 0,
        totalBytes: 0,
      };
      allocation.selfBytes += profileAllocation.selfBytes;
      allocation.totalBytes += profileAllocation.totalBytes;
      aggregateAllocations.set(key, allocation);
    }
  }
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

const main = (): void => {
  const commandArguments = process.argv.slice(2);
  const normalizedArguments =
    commandArguments[0] === "--" ? commandArguments.slice(1) : commandArguments;
  const command = new Command()
    .name("react-doctor-performance-memory")
    .description("Aggregate V8 heap profiles captured by the performance harness")
    .argument("<profile-directory>", "directory containing .heapprofile files")
    .option("--out <output-prefix>", "JSON and Markdown output prefix")
    .parse(normalizedArguments, { from: "user" });
  const commandOptions = command.opts<HeapProfileCommandOptions>();
  const profileDirectoryArgument = command.processedArgs[0];
  if (typeof profileDirectoryArgument !== "string") throw new Error("Missing profile directory");
  const profileDirectory = path.resolve(profileDirectoryArgument);
  const outputPrefix = path.resolve(commandOptions.out ?? path.join(profileDirectory, "memory"));
  const analysis = analyzeHeapProfiles(profileDirectory);
  fs.writeFileSync(`${outputPrefix}.json`, `${JSON.stringify(analysis, null, 2)}\n`);
  fs.writeFileSync(`${outputPrefix}.md`, renderAnalysisMarkdown(analysis));
  process.stdout.write(`${outputPrefix}.md\n`);
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCommanderMain(main);
