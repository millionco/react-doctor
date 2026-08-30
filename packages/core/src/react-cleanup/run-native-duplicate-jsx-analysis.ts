import { loadNativeOxlintBinding } from "../runners/oxlint/load-native-oxlint-binding.js";
import { isRecord } from "../utils/is-record.js";
import type {
  DuplicateJsxSubtreeFamily,
  DuplicateJsxSubtreeOccurrence,
  JsxSubtreeCandidate,
  ResolvedJsxDuplicationOptions,
} from "./detect-duplicate-jsx-subtrees.js";

const parseOccurrence = (value: unknown): DuplicateJsxSubtreeOccurrence | null => {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.startOffset !== "number" ||
    typeof value.endOffset !== "number" ||
    typeof value.startLine !== "number" ||
    typeof value.startColumn !== "number" ||
    typeof value.endLine !== "number" ||
    typeof value.endColumn !== "number" ||
    typeof value.rootName !== "string" ||
    (value.parentRootName !== null && typeof value.parentRootName !== "string") ||
    !Array.isArray(value.compositionPath) ||
    !value.compositionPath.every((part) => typeof part === "string") ||
    (value.compositionRootStartOffset !== null &&
      typeof value.compositionRootStartOffset !== "number")
  ) {
    return null;
  }
  return {
    path: value.path,
    startOffset: value.startOffset,
    endOffset: value.endOffset,
    startLine: value.startLine,
    startColumn: value.startColumn,
    endLine: value.endLine,
    endColumn: value.endColumn,
    rootName: value.rootName,
    parentRootName: value.parentRootName,
    compositionPath: value.compositionPath,
    compositionRootStartOffset: value.compositionRootStartOffset,
  };
};

const parseFamily = (value: unknown): DuplicateJsxSubtreeFamily | null => {
  if (
    !isRecord(value) ||
    typeof value.fingerprint !== "string" ||
    typeof value.nodeCount !== "number" ||
    typeof value.depth !== "number" ||
    typeof value.occurrenceCount !== "number" ||
    typeof value.distinctFileCount !== "number" ||
    typeof value.estimatedRemovableNodeCount !== "number" ||
    typeof value.estimatedRemovableLineCount !== "number" ||
    !Array.isArray(value.relatedOccurrences)
  ) {
    return null;
  }
  const primaryOccurrence = parseOccurrence(value.primaryOccurrence);
  const relatedOccurrences = value.relatedOccurrences.map(parseOccurrence);
  if (primaryOccurrence === null || relatedOccurrences.some((occurrence) => occurrence === null)) {
    return null;
  }
  return {
    fingerprint: value.fingerprint,
    nodeCount: value.nodeCount,
    depth: value.depth,
    occurrenceCount: value.occurrenceCount,
    distinctFileCount: value.distinctFileCount,
    estimatedRemovableNodeCount: value.estimatedRemovableNodeCount,
    estimatedRemovableLineCount: value.estimatedRemovableLineCount,
    primaryOccurrence,
    relatedOccurrences: relatedOccurrences.filter(
      (occurrence): occurrence is DuplicateJsxSubtreeOccurrence => occurrence !== null,
    ),
  };
};

const parseFamilies = (value: unknown): DuplicateJsxSubtreeFamily[] | null => {
  if (!Array.isArray(value)) return null;
  const families = value.map(parseFamily);
  return families.some((family) => family === null)
    ? null
    : families.filter((family): family is DuplicateJsxSubtreeFamily => family !== null);
};

const buildLocaleSortIndexes = (values: ReadonlyArray<string>): Map<string, number> => {
  const sortedValues = [...new Set(values)].sort((left, right) => left.localeCompare(right));
  const sortIndexByValue = new Map<string, number>();
  let sortIndex = 0;
  let previousValue: string | undefined;
  for (const value of sortedValues) {
    if (previousValue !== undefined && previousValue.localeCompare(value) !== 0) sortIndex += 1;
    sortIndexByValue.set(value, sortIndex);
    previousValue = value;
  }
  return sortIndexByValue;
};

export const runNativeDuplicateJsxAnalysis = (
  candidates: ReadonlyArray<JsxSubtreeCandidate>,
  options: ResolvedJsxDuplicationOptions,
): DuplicateJsxSubtreeFamily[] | null => {
  const binding = loadNativeOxlintBinding();
  if (binding === null || typeof binding.analyzeReactDoctorDuplicateJsx !== "function") {
    return null;
  }
  const pathSortIndexByPath = buildLocaleSortIndexes(
    candidates.map((candidate) => candidate.occurrence.path),
  );
  const fingerprintSortIndexByFingerprint = buildLocaleSortIndexes(
    candidates.map((candidate) => candidate.metadata.fingerprint),
  );
  let outputJson: unknown;
  try {
    outputJson = binding.analyzeReactDoctorDuplicateJsx(
      JSON.stringify({
        candidates: candidates.map((candidate) => ({
          fingerprint: candidate.metadata.fingerprint,
          fingerprintSortIndex:
            fingerprintSortIndexByFingerprint.get(candidate.metadata.fingerprint) ?? 0,
          nodeCount: candidate.metadata.nodeCount,
          depth: candidate.metadata.depth,
          occurrence: {
            ...candidate.occurrence,
            pathSortIndex: pathSortIndexByPath.get(candidate.occurrence.path) ?? 0,
          },
        })),
        minimumNodeCount: options.minimumNodeCount,
        minimumDepth: options.minimumDepth,
        minimumOccurrences: options.minimumOccurrences,
        minimumDistinctFiles: options.minimumDistinctFiles,
        maxFamilies: options.maxFamilies,
      }),
    );
  } catch {
    return null;
  }
  if (typeof outputJson !== "string") return null;
  let output: unknown;
  try {
    output = JSON.parse(outputJson);
  } catch {
    return null;
  }
  return parseFamilies(output);
};
