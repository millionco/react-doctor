import { SENTINEL_FILE_MARKER } from "./concatenate.js";

export interface RawDuplicateBlockOccurrence {
  fileIndex: number;
  tokenOffsetWithinFile: number;
}

export interface RawDuplicateBlock {
  instances: RawDuplicateBlockOccurrence[];
  tokenLength: number;
}

interface MonotoneStackEntry {
  lcpValue: number;
  startIndex: number;
}

const buildRawBlock = (
  suffixArray: number[],
  fileOf: number[],
  fileOffsets: number[],
  filesTokenCounts: number[],
  intervalBegin: number,
  intervalEnd: number,
  tokenLength: number,
): RawDuplicateBlock | undefined => {
  const candidateInstances: RawDuplicateBlockOccurrence[] = [];
  for (let suffixIndex = intervalBegin; suffixIndex < intervalEnd; suffixIndex++) {
    const startPosition = suffixArray[suffixIndex];
    const fileIndex = fileOf[startPosition];
    if (fileIndex === SENTINEL_FILE_MARKER) continue;
    const tokenOffsetWithinFile = startPosition - fileOffsets[fileIndex];
    if (tokenOffsetWithinFile + tokenLength > filesTokenCounts[fileIndex]) continue;
    candidateInstances.push({ fileIndex, tokenOffsetWithinFile });
  }

  if (candidateInstances.length < 2) return undefined;

  candidateInstances.sort((leftInstance, rightInstance) => {
    if (leftInstance.fileIndex !== rightInstance.fileIndex) {
      return leftInstance.fileIndex - rightInstance.fileIndex;
    }
    return leftInstance.tokenOffsetWithinFile - rightInstance.tokenOffsetWithinFile;
  });

  const dedupedInstances: RawDuplicateBlockOccurrence[] = [];
  for (const instance of candidateInstances) {
    const lastInstance = dedupedInstances[dedupedInstances.length - 1];
    const isOverlappingInSameFile =
      lastInstance !== undefined &&
      lastInstance.fileIndex === instance.fileIndex &&
      instance.tokenOffsetWithinFile < lastInstance.tokenOffsetWithinFile + tokenLength;
    if (isOverlappingInSameFile) continue;
    dedupedInstances.push(instance);
  }

  if (dedupedInstances.length < 2) return undefined;
  return { instances: dedupedInstances, tokenLength };
};

/**
 * Walks `lcpArray` with a monotone stack to materialize every maximal
 * interval `[i, j]` whose minimum LCP is >= `minTokens`. Within-file
 * overlapping occurrences are dropped (keep the earliest non-overlapping
 * prefix), and any block left with fewer than two occurrences is discarded.
 */
export const extractRawDuplicateBlocks = (
  suffixArray: number[],
  lcpArray: number[],
  fileOf: number[],
  fileOffsets: number[],
  filesTokenCounts: number[],
  minTokens: number,
): RawDuplicateBlock[] => {
  const sequenceLength = suffixArray.length;
  if (sequenceLength < 2) return [];

  const rawBlocks: RawDuplicateBlock[] = [];
  const monotoneStack: MonotoneStackEntry[] = [];

  for (let scanIndex = 1; scanIndex <= sequenceLength; scanIndex++) {
    const currentLcp = scanIndex < sequenceLength ? lcpArray[scanIndex] : 0;
    let intervalStart = scanIndex;

    while (
      monotoneStack.length > 0 &&
      monotoneStack[monotoneStack.length - 1].lcpValue > currentLcp
    ) {
      const popped = monotoneStack.pop()!;
      intervalStart = popped.startIndex;
      if (popped.lcpValue >= minTokens) {
        const candidate = buildRawBlock(
          suffixArray,
          fileOf,
          fileOffsets,
          filesTokenCounts,
          intervalStart - 1,
          scanIndex,
          popped.lcpValue,
        );
        if (candidate) rawBlocks.push(candidate);
      }
    }

    if (scanIndex < sequenceLength) {
      monotoneStack.push({ lcpValue: currentLcp, startIndex: intervalStart });
    }
  }

  return rawBlocks;
};
