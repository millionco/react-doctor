import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  MICROSECONDS_PER_SECOND,
  PERCENT_MULTIPLIER,
  PROFILE_TOP_FRAME_COUNT,
} from "./constants.ts";
import { collectProfilePaths } from "./collect-profile-paths.ts";
import type {
  CpuProfile,
  CpuProfileAnalysis,
  CpuProfileFrameSummary,
  CpuProfileNode,
  CpuProfileProcessSummary,
} from "./types.ts";

interface MutableFrameTiming {
  callFrame: CpuProfileNode["callFrame"];
  selfMicroseconds: number;
  totalMicroseconds: number;
}

interface AnalyzedProfile {
  processSummary: CpuProfileProcessSummary;
  timings: Map<string, MutableFrameTiming>;
}

interface CpuProfileCommandOptions {
  out?: string;
}

const isCpuProfileNode = (value: unknown): value is CpuProfileNode => {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || typeof value.id !== "number") return false;
  if (!("callFrame" in value) || typeof value.callFrame !== "object" || value.callFrame === null) {
    return false;
  }
  return (
    "functionName" in value.callFrame &&
    typeof value.callFrame.functionName === "string" &&
    "url" in value.callFrame &&
    typeof value.callFrame.url === "string" &&
    "lineNumber" in value.callFrame &&
    typeof value.callFrame.lineNumber === "number" &&
    "columnNumber" in value.callFrame &&
    typeof value.callFrame.columnNumber === "number"
  );
};

const isCpuProfile = (value: unknown): value is CpuProfile => {
  if (typeof value !== "object" || value === null) return false;
  if (!("nodes" in value) || !Array.isArray(value.nodes) || !value.nodes.every(isCpuProfileNode)) {
    return false;
  }
  return (
    (!("samples" in value) ||
      (Array.isArray(value.samples) &&
        value.samples.every((sample) => typeof sample === "number"))) &&
    (!("timeDeltas" in value) ||
      (Array.isArray(value.timeDeltas) &&
        value.timeDeltas.every((delta) => typeof delta === "number")))
  );
};

const frameKey = (node: CpuProfileNode): string =>
  [
    node.callFrame.functionName || "(anonymous)",
    node.callFrame.url,
    String(node.callFrame.lineNumber),
    String(node.callFrame.columnNumber),
  ].join("::");

const resolveProcessRole = (profile: CpuProfile): string => {
  const urls = profile.nodes.map((node) => node.callFrame.url).join("\n");
  if (
    urls.includes("deslop-js") ||
    urls.includes("entries-worker") ||
    urls.includes("parse-worker")
  ) {
    return "dead-code";
  }
  if (urls.includes("packages/react-doctor/dist/cli.js")) return "react-doctor";
  if (urls.includes("oxlint") || urls.includes("oxlint-plugin-react-doctor")) return "oxlint";
  return "node";
};

const toFrameSummaries = (
  timings: Map<string, MutableFrameTiming>,
  sampledMicroseconds: number,
): CpuProfileFrameSummary[] =>
  [...timings.values()]
    .map((timing) => ({
      functionName: timing.callFrame.functionName || "(anonymous)",
      url: timing.callFrame.url,
      lineNumber: timing.callFrame.lineNumber + 1,
      selfMicroseconds: timing.selfMicroseconds,
      totalMicroseconds: timing.totalMicroseconds,
      selfPercent:
        sampledMicroseconds === 0
          ? 0
          : (timing.selfMicroseconds / sampledMicroseconds) * PERCENT_MULTIPLIER,
      totalPercent:
        sampledMicroseconds === 0
          ? 0
          : (timing.totalMicroseconds / sampledMicroseconds) * PERCENT_MULTIPLIER,
    }))
    .toSorted(
      (leftFrame, rightFrame) =>
        rightFrame.selfMicroseconds - leftFrame.selfMicroseconds ||
        rightFrame.totalMicroseconds - leftFrame.totalMicroseconds,
    );

const analyzeProfile = (profilePath: string): AnalyzedProfile => {
  const parsedProfile: unknown = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  if (!isCpuProfile(parsedProfile)) throw new Error(`Invalid CPU profile: ${profilePath}`);
  const nodesById = new Map(parsedProfile.nodes.map((node) => [node.id, node]));
  const frameKeysByNodeId = new Map(parsedProfile.nodes.map((node) => [node.id, frameKey(node)]));
  const parentById = new Map<number, number>();
  for (const node of parsedProfile.nodes) {
    for (const childId of node.children ?? []) parentById.set(childId, node.id);
  }
  const timings = new Map<string, MutableFrameTiming>();
  const visitedFrameKeyAtSample = new Map<string, number>();
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
    const selfTiming = timings.get(selfKey) ?? {
      callFrame: sampleNode.callFrame,
      selfMicroseconds: 0,
      totalMicroseconds: 0,
    };
    selfTiming.selfMicroseconds += deltaMicroseconds;
    timings.set(selfKey, selfTiming);
    let currentNode: CpuProfileNode | undefined = sampleNode;
    while (currentNode !== undefined) {
      const currentFrameKey = frameKeysByNodeId.get(currentNode.id);
      if (currentFrameKey !== undefined && visitedFrameKeyAtSample.get(currentFrameKey) !== index) {
        const timing = timings.get(currentFrameKey) ?? {
          callFrame: currentNode.callFrame,
          selfMicroseconds: 0,
          totalMicroseconds: 0,
        };
        timing.totalMicroseconds += deltaMicroseconds;
        timings.set(currentFrameKey, timing);
        visitedFrameKeyAtSample.set(currentFrameKey, index);
      }
      const parentId = parentById.get(currentNode.id);
      currentNode = parentId === undefined ? undefined : nodesById.get(parentId);
    }
  }
  return {
    processSummary: {
      file: profilePath,
      role: resolveProcessRole(parsedProfile),
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
  const aggregateTimings = new Map<string, MutableFrameTiming>();
  for (const analyzedProfile of analyzedProfiles) {
    for (const [key, profileTiming] of analyzedProfile.timings) {
      const timing = aggregateTimings.get(key) ?? {
        callFrame: profileTiming.callFrame,
        selfMicroseconds: 0,
        totalMicroseconds: 0,
      };
      timing.selfMicroseconds += profileTiming.selfMicroseconds;
      timing.totalMicroseconds += profileTiming.totalMicroseconds;
      aggregateTimings.set(key, timing);
    }
  }
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

const main = (): void => {
  const commandArguments = process.argv.slice(2);
  const normalizedArguments =
    commandArguments[0] === "--" ? commandArguments.slice(1) : commandArguments;
  const command = new Command()
    .name("react-doctor-performance-profile")
    .description("Aggregate V8 CPU profiles captured by the performance harness")
    .argument("<profile-directory>", "directory containing .cpuprofile files")
    .option("--out <output-prefix>", "JSON and Markdown output prefix")
    .parse(normalizedArguments, { from: "user" });
  const commandOptions = command.opts<CpuProfileCommandOptions>();
  const profileDirectoryArgument = command.processedArgs[0];
  if (typeof profileDirectoryArgument !== "string") throw new Error("Missing profile directory");
  const profileDirectory = path.resolve(profileDirectoryArgument);
  const outputPrefix = path.resolve(commandOptions.out ?? path.join(profileDirectory, "analysis"));
  const analysis = analyzeCpuProfiles(profileDirectory);
  fs.writeFileSync(`${outputPrefix}.json`, `${JSON.stringify(analysis, null, 2)}\n`);
  fs.writeFileSync(`${outputPrefix}.md`, renderAnalysisMarkdown(analysis));
  process.stdout.write(`${outputPrefix}.md\n`);
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
