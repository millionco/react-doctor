import { loadNativeOxlintBinding } from "../runners/oxlint/load-native-oxlint-binding.js";
import { handleNativeOxlintFailure } from "../runners/oxlint/handle-native-oxlint-failure.js";
import { isRecord } from "../utils/is-record.js";
import { parseJsxSubtreeOccurrence } from "./utils/parse-jsx-subtree-occurrence.js";
import type {
  DuplicateJsxSubtreeFamily,
  DuplicateJsxSubtreeOccurrence,
  JsxSubtreeCandidate,
  ResolvedJsxDuplicationOptions,
} from "./detect-duplicate-jsx-subtrees.js";

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
  const primaryOccurrence = parseJsxSubtreeOccurrence(value.primaryOccurrence);
  const relatedOccurrences = value.relatedOccurrences.map(parseJsxSubtreeOccurrence);
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
    handleNativeOxlintFailure(
      "The required native Oxlint binding does not provide duplicate JSX analysis.",
    );
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
  } catch (error) {
    handleNativeOxlintFailure("The required native duplicate JSX analysis failed.", error);
    return null;
  }
  if (typeof outputJson !== "string") {
    handleNativeOxlintFailure(
      "The required native duplicate JSX analysis returned a non-string result.",
    );
    return null;
  }
  let output: unknown;
  try {
    output = JSON.parse(outputJson);
  } catch (error) {
    handleNativeOxlintFailure(
      "The required native duplicate JSX analysis returned invalid JSON.",
      error,
    );
    return null;
  }
  const families = parseFamilies(output);
  if (families === null) {
    handleNativeOxlintFailure(
      "The required native duplicate JSX analysis returned an invalid result.",
    );
    return null;
  }
  return families;
};
