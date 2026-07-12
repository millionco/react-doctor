import * as fs from "node:fs";
import * as path from "node:path";
import { PERCENT_MULTIPLIER } from "./constants.ts";
import { isRecordWithFields } from "./is-record-with-fields.ts";
import type { V8ProfileCallFrame } from "./types.ts";

export interface CollectProfilePathsInput {
  directory: string;
  extension: string;
}

export const collectProfilePaths = (input: CollectProfilePathsInput): string[] => {
  const profilePaths: string[] = [];
  const pendingDirectories = [input.directory];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (currentDirectory === undefined) continue;
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) pendingDirectories.push(entryPath);
      else if (entry.isFile() && entry.name.endsWith(input.extension)) {
        profilePaths.push(entryPath);
      }
    }
  }
  return profilePaths.toSorted();
};

export interface MutableFrameValue {
  callFrame: V8ProfileCallFrame;
  self: number;
  total: number;
}

export interface RankedFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  self: number;
  total: number;
  selfPercent: number;
  totalPercent: number;
}

export interface ProfileFrameChainInput {
  readonly startNode: { id: number; callFrame: V8ProfileCallFrame };
  readonly amount: number;
  readonly nodesById: ReadonlyMap<number, { id: number; callFrame: V8ProfileCallFrame }>;
  readonly parentById: ReadonlyMap<number, number>;
  readonly frameKeysByNodeId: ReadonlyMap<number, string>;
  readonly frames: Map<string, MutableFrameValue>;
  readonly profilePath: string;
}

export const isCallFrame = (value: unknown): value is V8ProfileCallFrame =>
  isRecordWithFields(value, {
    functionName: "string",
    url: "string",
    lineNumber: "number",
    columnNumber: "number",
  });

export const profileFrameKey = (callFrame: V8ProfileCallFrame): string =>
  [
    callFrame.functionName || "(anonymous)",
    callFrame.url,
    String(callFrame.lineNumber),
    String(callFrame.columnNumber),
  ].join("::");

export const resolveProfileProcessRole = (
  callFrames: ReadonlyArray<V8ProfileCallFrame>,
): string => {
  const urls = callFrames.map((callFrame) => callFrame.url).join("\n");
  if (urls.includes("packages/react-doctor/dist/cli.js")) return "react-doctor";
  if (
    urls.includes("deslop-js") ||
    urls.includes("entries-worker") ||
    urls.includes("parse-worker")
  ) {
    return "dead-code";
  }
  if (urls.includes("oxlint") || urls.includes("oxlint-plugin-react-doctor")) return "oxlint";
  return "node";
};

export const getFrameValue = (
  frames: Map<string, MutableFrameValue>,
  key: string,
  callFrame: V8ProfileCallFrame,
): MutableFrameValue => {
  const existingFrame = frames.get(key);
  if (existingFrame !== undefined) return existingFrame;
  const createdFrame: MutableFrameValue = { callFrame, self: 0, total: 0 };
  frames.set(key, createdFrame);
  return createdFrame;
};

export const addFrameChainTotals = (input: ProfileFrameChainInput): void => {
  const visitedFrameKeys = new Set<string>();
  const visitedNodeIds = new Set<number>();
  let currentNode: { id: number; callFrame: V8ProfileCallFrame } | undefined = input.startNode;
  while (currentNode !== undefined) {
    if (visitedNodeIds.has(currentNode.id)) {
      throw new Error(`Invalid profile with cyclic nodes: ${input.profilePath}`);
    }
    visitedNodeIds.add(currentNode.id);
    const currentFrameKey = input.frameKeysByNodeId.get(currentNode.id);
    if (currentFrameKey !== undefined && !visitedFrameKeys.has(currentFrameKey)) {
      getFrameValue(input.frames, currentFrameKey, currentNode.callFrame).total += input.amount;
      visitedFrameKeys.add(currentFrameKey);
    }
    const parentId = input.parentById.get(currentNode.id);
    currentNode = parentId === undefined ? undefined : input.nodesById.get(parentId);
  }
};

export const aggregateFrameValues = (
  frameMaps: ReadonlyArray<Map<string, MutableFrameValue>>,
): Map<string, MutableFrameValue> => {
  const aggregateFrames = new Map<string, MutableFrameValue>();
  for (const frames of frameMaps) {
    for (const [key, frameValue] of frames) {
      const aggregateFrame = getFrameValue(aggregateFrames, key, frameValue.callFrame);
      aggregateFrame.self += frameValue.self;
      aggregateFrame.total += frameValue.total;
    }
  }
  return aggregateFrames;
};

export const toRankedFrames = (
  frames: Map<string, MutableFrameValue>,
  sampledTotal: number,
): RankedFrame[] =>
  [...frames.values()]
    .map((frame) => ({
      functionName: frame.callFrame.functionName || "(anonymous)",
      url: frame.callFrame.url,
      lineNumber: frame.callFrame.lineNumber + 1,
      self: frame.self,
      total: frame.total,
      selfPercent: sampledTotal === 0 ? 0 : (frame.self / sampledTotal) * PERCENT_MULTIPLIER,
      totalPercent: sampledTotal === 0 ? 0 : (frame.total / sampledTotal) * PERCENT_MULTIPLIER,
    }))
    .toSorted(
      (leftFrame, rightFrame) =>
        rightFrame.self - leftFrame.self || rightFrame.total - leftFrame.total,
    );
