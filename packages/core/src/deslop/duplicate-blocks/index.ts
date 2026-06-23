import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { parseSync } from "oxc-parser";
import {
  MAX_PARSE_FILE_SIZE_BYTES,
  BINARY_DETECTION_NULL_BYTE_THRESHOLD,
  BINARY_DETECTION_SAMPLE_BYTES,
  MINIFIED_DETECTION_AVG_LINE_LENGTH_THRESHOLD,
  MINIFIED_DETECTION_MIN_BYTES,
} from "../constants.js";
import type {
  DuplicateBlock,
  DuplicateBlockCluster,
  DuplicateBlockOccurrence,
  DuplicateBlocksConfig,
  DependencyGraph,
  ShadowedDirectoryPair,
} from "../types.js";
import { computeLineStarts } from "../utils/compute-line-starts.js";
import { offsetToLineColumn } from "../utils/offset-to-line-column.js";
import { rankReduceAndConcatenate } from "./concatenate.js";
import { extractRawDuplicateBlocks, type RawDuplicateBlock } from "./extract.js";
import { groupDuplicateBlocksIntoClusters } from "./clusters.js";
import { detectShadowedDirectoryPairs } from "./shadowed-directory-pairs.js";
import { normalizeAndHashTokens } from "./normalize.js";
import { buildLcpArray, buildSuffixArray } from "./suffix-array.js";
import type { SourceToken } from "./token-types.js";
import { tokenizeAst } from "./token-visitor.js";

interface TokenizedFile {
  path: string;
  sourceTokens: SourceToken[];
  /** 1-based byte offsets at line starts for line/column reconstruction. */
  lineStarts: number[];
  lineCount: number;
}

const isBinaryFile = (sourceText: string): boolean => {
  const sampleEnd = Math.min(sourceText.length, BINARY_DETECTION_SAMPLE_BYTES);
  let nullByteCount = 0;
  for (let charIndex = 0; charIndex < sampleEnd; charIndex++) {
    if (sourceText.charCodeAt(charIndex) === 0) {
      nullByteCount++;
      if (nullByteCount >= BINARY_DETECTION_NULL_BYTE_THRESHOLD) return true;
    }
  }
  return false;
};

const isMinifiedSource = (sourceText: string): boolean => {
  if (sourceText.length < MINIFIED_DETECTION_MIN_BYTES) return false;
  const lineCount = (sourceText.match(/\n/g)?.length ?? 0) + 1;
  return sourceText.length / lineCount > MINIFIED_DETECTION_AVG_LINE_LENGTH_THRESHOLD;
};

const tokenizeFile = (filePath: string): TokenizedFile | undefined => {
  let sourceStat: ReturnType<typeof statSync>;
  try {
    sourceStat = statSync(filePath);
  } catch {
    return undefined;
  }
  if (sourceStat.size > MAX_PARSE_FILE_SIZE_BYTES) return undefined;

  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
  if (sourceText.length === 0) return undefined;
  if (isBinaryFile(sourceText)) return undefined;
  if (isMinifiedSource(sourceText)) return undefined;

  let parseResult: ReturnType<typeof parseSync>;
  try {
    parseResult = parseSync(filePath, sourceText);
  } catch {
    return undefined;
  }
  const sourceTokens = tokenizeAst(parseResult.program);
  if (sourceTokens.length === 0) return undefined;

  const lineStarts = computeLineStarts(sourceText);
  return {
    path: filePath,
    sourceTokens,
    lineStarts,
    lineCount: lineStarts.length,
  };
};

const buildCloneInstance = (
  rawInstance: { fileIndex: number; tokenOffsetWithinFile: number },
  tokenLength: number,
  tokenizedFiles: TokenizedFile[],
): DuplicateBlockOccurrence => {
  const file = tokenizedFiles[rawInstance.fileIndex];
  const firstToken = file.sourceTokens[rawInstance.tokenOffsetWithinFile];
  const lastToken = file.sourceTokens[rawInstance.tokenOffsetWithinFile + tokenLength - 1];
  const startSpan = offsetToLineColumn(firstToken.start, file.lineStarts);
  const endSpan = offsetToLineColumn(lastToken.end, file.lineStarts);
  return {
    path: file.path,
    startLine: startSpan.line,
    endLine: endSpan.line,
    startColumn: startSpan.column,
    endColumn: endSpan.column,
  };
};

const directoryOf = (filePath: string): string => dirname(filePath);

const filterRawBlocksToReportableDuplicates = (
  rawBlocks: RawDuplicateBlock[],
  tokenizedFiles: TokenizedFile[],
  config: DuplicateBlocksConfig,
): DuplicateBlock[] => {
  const duplicateBlocks: DuplicateBlock[] = [];
  for (const rawBlock of rawBlocks) {
    const instances = rawBlock.instances.map((rawInstance) =>
      buildCloneInstance(rawInstance, rawBlock.tokenLength, tokenizedFiles),
    );

    let lineCount = 0;
    for (const instance of instances) {
      const instanceLineCount = instance.endLine - instance.startLine + 1;
      if (instanceLineCount > lineCount) lineCount = instanceLineCount;
    }
    if (lineCount < config.minLines) continue;
    if (instances.length < config.minOccurrences) continue;

    if (config.skipLocal) {
      const distinctDirectories = new Set(instances.map((instance) => directoryOf(instance.path)));
      if (distinctDirectories.size < 2) continue;
    }

    const distinctFiles = new Set(instances.map((instance) => instance.path));
    const confidence = distinctFiles.size >= 2 ? "high" : "medium";

    duplicateBlocks.push({
      instances,
      tokenCount: rawBlock.tokenLength,
      lineCount,
      confidence,
      reason:
        distinctFiles.size >= 2
          ? `${instances.length} occurrences spanning ${distinctFiles.size} files (≥${rawBlock.tokenLength} tokens, ${lineCount} lines)`
          : `${instances.length} occurrences within a single file (≥${rawBlock.tokenLength} tokens, ${lineCount} lines)`,
    });
  }

  const maximalBlocks = dropBlocksSubsumedByLongerSibling(duplicateBlocks);

  maximalBlocks.sort((firstClone, secondClone) => {
    if (firstClone.lineCount !== secondClone.lineCount) {
      return secondClone.lineCount - firstClone.lineCount;
    }
    return secondClone.tokenCount - firstClone.tokenCount;
  });
  return maximalBlocks;
};

/**
 * The suffix-array + LCP-interval scan emits one block per LCP interval, but
 * nested intervals routinely yield the same set of source spans at multiple
 * lengths (the same maximal repeat reported at L, L-1, L-2, …). Drop any
 * block whose every instance is spatially contained inside some other block's
 * matching instance — that other block is strictly more informative.
 *
 * O(N²) worst-case, but N here is post-filter blocks (typically <1000 even on
 * large monorepos), and the early-exit on instance-count mismatch keeps it
 * tight in practice.
 */
const dropBlocksSubsumedByLongerSibling = (blocks: DuplicateBlock[]): DuplicateBlock[] => {
  const sorted = [...blocks].sort((firstBlock, secondBlock) => {
    if (firstBlock.tokenCount !== secondBlock.tokenCount) {
      return secondBlock.tokenCount - firstBlock.tokenCount;
    }
    return secondBlock.lineCount - firstBlock.lineCount;
  });

  const survivors: DuplicateBlock[] = [];
  for (const candidate of sorted) {
    let subsumed = false;
    for (const survivor of survivors) {
      if (survivor.instances.length !== candidate.instances.length) continue;
      if (allInstancesContainedIn(candidate, survivor)) {
        subsumed = true;
        break;
      }
    }
    if (!subsumed) survivors.push(candidate);
  }
  return survivors;
};

const allInstancesContainedIn = (candidate: DuplicateBlock, longer: DuplicateBlock): boolean => {
  for (const candidateInstance of candidate.instances) {
    let matched = false;
    for (const longerInstance of longer.instances) {
      if (
        candidateInstance.path === longerInstance.path &&
        isSpanContained(candidateInstance, longerInstance)
      ) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
};

const isSpanContained = (
  inner: { startLine: number; startColumn: number; endLine: number; endColumn: number },
  outer: { startLine: number; startColumn: number; endLine: number; endColumn: number },
): boolean => {
  const innerStartsAfterOuter =
    inner.startLine > outer.startLine ||
    (inner.startLine === outer.startLine && inner.startColumn >= outer.startColumn);
  const innerEndsBeforeOuter =
    inner.endLine < outer.endLine ||
    (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn);
  return innerStartsAfterOuter && innerEndsBeforeOuter;
};

export interface DuplicateBlocksResult {
  duplicateBlocks: DuplicateBlock[];
  duplicateBlockClusters: DuplicateBlockCluster[];
  shadowedDirectoryPairs: ShadowedDirectoryPair[];
}

/**
 * Token-based duplicate block detector.
 *
 * Pipeline:
 *  1. Tokenize each file with the AST visitor in `token-visitor.ts`
 *  2. Hash + normalize tokens with the chosen detection mode
 *  3. Concatenate every file's hashed tokens with unique negative sentinels
 *  4. Build a suffix array (prefix doubling + radix sort) and LCP array
 *  5. Stack-based LCP-interval scan extracts maximal duplicate blocks
 *  6. Filter on min-tokens / min-lines / min-occurrences / skip-local
 *  7. Group clones into families; collapse N two-file families with matching
 *     basenames into a `ShadowedDirectoryPair` finding
 *
 * Returns empty arrays when `config.enabled` is false.
 */
export const detectDuplicateBlocks = (
  graph: DependencyGraph,
  config: DuplicateBlocksConfig | undefined,
  rootDir: string,
): DuplicateBlocksResult => {
  if (!config || !config.enabled) {
    return { duplicateBlocks: [], duplicateBlockClusters: [], shadowedDirectoryPairs: [] };
  }

  const tokenizedFiles: TokenizedFile[] = [];
  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    if (module.isConfigFile) continue;
    const tokenizedFile = tokenizeFile(module.fileId.path);
    if (!tokenizedFile) continue;
    tokenizedFiles.push(tokenizedFile);
  }
  if (tokenizedFiles.length === 0) {
    return { duplicateBlocks: [], duplicateBlockClusters: [], shadowedDirectoryPairs: [] };
  }

  const filesHashedTokens = tokenizedFiles.map((file) =>
    normalizeAndHashTokens(file.sourceTokens, config.mode),
  );
  const filesTokenCounts = filesHashedTokens.map((fileTokens) => fileTokens.length);

  const filesHaveEnoughTokens = filesTokenCounts.some((count) => count >= config.minTokens);
  if (!filesHaveEnoughTokens) {
    return { duplicateBlocks: [], duplicateBlockClusters: [], shadowedDirectoryPairs: [] };
  }

  const concatenation = rankReduceAndConcatenate(filesHashedTokens);
  if (concatenation.tokenSequence.length === 0) {
    return { duplicateBlocks: [], duplicateBlockClusters: [], shadowedDirectoryPairs: [] };
  }

  const suffixArray = buildSuffixArray(concatenation.tokenSequence);
  const lcpArray = buildLcpArray(concatenation.tokenSequence, suffixArray);
  const rawDuplicateBlocks = extractRawDuplicateBlocks(
    suffixArray,
    lcpArray,
    concatenation.fileOf,
    concatenation.fileOffsets,
    filesTokenCounts,
    config.minTokens,
  );

  const duplicateBlocks = filterRawBlocksToReportableDuplicates(
    rawDuplicateBlocks,
    tokenizedFiles,
    config,
  );
  const duplicateBlockClusters = groupDuplicateBlocksIntoClusters(duplicateBlocks);
  const shadowedDirectoryPairs = detectShadowedDirectoryPairs(duplicateBlockClusters, rootDir);

  return { duplicateBlocks, duplicateBlockClusters, shadowedDirectoryPairs };
};
