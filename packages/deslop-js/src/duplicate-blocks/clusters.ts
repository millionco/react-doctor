import { DUPLICATE_BLOCK_MODULE_EXTRACTION_THRESHOLD_LINES } from "../constants.js";
import type {
  DuplicateBlock,
  DuplicateBlockCluster,
  DuplicateBlockRefactoringHint,
} from "../types.js";

interface ClusterBucket {
  files: string[];
  blocks: DuplicateBlock[];
}

const baseName = (filePath: string): string => {
  const trailingSlashIndex = filePath.lastIndexOf("/");
  return trailingSlashIndex === -1 ? filePath : filePath.slice(trailingSlashIndex + 1);
};

const buildSuggestions = (
  files: string[],
  blocks: DuplicateBlock[],
  totalDuplicatedLines: number,
): DuplicateBlockRefactoringHint[] => {
  const fileBaseNames = files.map((filePath) => baseName(filePath));
  const isCrossFile = files.length >= 2;

  if (isCrossFile && totalDuplicatedLines >= DUPLICATE_BLOCK_MODULE_EXTRACTION_THRESHOLD_LINES) {
    const estimatedSavings = blocks.reduce(
      (runningSum, block) => runningSum + block.lineCount * Math.max(0, block.instances.length - 1),
      0,
    );
    return [
      {
        kind: "extract-module",
        description: `Extract ${blocks.length} shared duplicate block${
          blocks.length === 1 ? "" : "s"
        } (${totalDuplicatedLines} lines) from ${fileBaseNames.join(", ")} into a shared module`,
        estimatedSavings,
      },
    ];
  }

  return blocks.map((block) => ({
    kind: "extract-function",
    description: `Extract shared function (${block.lineCount} lines) from ${fileBaseNames.join(", ")}`,
    estimatedSavings: block.lineCount * Math.max(0, block.instances.length - 1),
  }));
};

export const groupDuplicateBlocksIntoClusters = (
  duplicateBlocks: DuplicateBlock[],
): DuplicateBlockCluster[] => {
  if (duplicateBlocks.length === 0) return [];

  const fileSetKeyToBucket = new Map<string, ClusterBucket>();
  for (const block of duplicateBlocks) {
    const sortedFiles = [...new Set(block.instances.map((instance) => instance.path))].sort();
    const fileSetKey = sortedFiles.join("|");
    const existing = fileSetKeyToBucket.get(fileSetKey);
    if (existing) {
      existing.blocks.push(block);
    } else {
      fileSetKeyToBucket.set(fileSetKey, { files: sortedFiles, blocks: [block] });
    }
  }

  const clusters: DuplicateBlockCluster[] = [];
  for (const bucket of fileSetKeyToBucket.values()) {
    const totalDuplicatedLines = bucket.blocks.reduce(
      (runningSum, block) => runningSum + block.lineCount,
      0,
    );
    const totalDuplicatedTokens = bucket.blocks.reduce(
      (runningSum, block) => runningSum + block.tokenCount,
      0,
    );
    clusters.push({
      files: bucket.files,
      groups: bucket.blocks,
      totalDuplicatedLines,
      totalDuplicatedTokens,
      suggestions: buildSuggestions(bucket.files, bucket.blocks, totalDuplicatedLines),
    });
  }

  clusters.sort((leftCluster, rightCluster) => {
    if (leftCluster.totalDuplicatedLines !== rightCluster.totalDuplicatedLines) {
      return rightCluster.totalDuplicatedLines - leftCluster.totalDuplicatedLines;
    }
    return rightCluster.groups.length - leftCluster.groups.length;
  });
  return clusters;
};
