import type { HashedToken } from "./token-types.js";

export interface ConcatenationResult {
  tokenSequence: number[];
  fileOf: number[];
  fileOffsets: number[];
}

const SENTINEL_FILE_INDEX = Number.MAX_SAFE_INTEGER;

/**
 * Rank-reduce token hashes to dense 0..K-1 integers and concatenate every
 * file's reduced sequence with a unique negative sentinel between files. Dense
 * ranks shrink the suffix-array's bucket counters from ~4 billion to a few
 * thousand (the standard prefix-doubling speedup), and negative sentinels
 * guarantee no real-token suffix can match across a file boundary.
 */
export const rankReduceAndConcatenate = (
  filesHashedTokens: HashedToken[][],
): ConcatenationResult => {
  const uniqueHashes = new Set<number>();
  for (const fileTokens of filesHashedTokens) {
    for (const hashedToken of fileTokens) uniqueHashes.add(hashedToken.hash);
  }
  const sortedUniqueHashes = [...uniqueHashes].sort((leftHash, rightHash) => leftHash - rightHash);
  const hashToRank = new Map<number, number>();
  for (let rankIndex = 0; rankIndex < sortedUniqueHashes.length; rankIndex++) {
    hashToRank.set(sortedUniqueHashes[rankIndex], rankIndex + 1);
  }

  const totalTokens = filesHashedTokens.reduce(
    (runningSum, fileTokens) => runningSum + fileTokens.length,
    0,
  );
  const sentinelCount = Math.max(0, filesHashedTokens.length - 1);
  const sequenceLength = totalTokens + sentinelCount;

  const tokenSequence: number[] = new Array(sequenceLength);
  const fileOf: number[] = new Array(sequenceLength);
  const fileOffsets: number[] = new Array(filesHashedTokens.length);

  let writeCursor = 0;
  let nextSentinelValue = -1;

  for (let fileIndex = 0; fileIndex < filesHashedTokens.length; fileIndex++) {
    fileOffsets[fileIndex] = writeCursor;
    const fileTokens = filesHashedTokens[fileIndex];
    for (const hashedToken of fileTokens) {
      tokenSequence[writeCursor] = hashToRank.get(hashedToken.hash) ?? 0;
      fileOf[writeCursor] = fileIndex;
      writeCursor++;
    }
    if (fileIndex < filesHashedTokens.length - 1) {
      tokenSequence[writeCursor] = nextSentinelValue;
      fileOf[writeCursor] = SENTINEL_FILE_INDEX;
      writeCursor++;
      nextSentinelValue--;
    }
  }

  return { tokenSequence, fileOf, fileOffsets };
};

export const SENTINEL_FILE_MARKER = SENTINEL_FILE_INDEX;
