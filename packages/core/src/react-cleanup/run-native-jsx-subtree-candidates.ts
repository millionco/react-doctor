import { handleNativeOxlintFailure } from "../runners/oxlint/handle-native-oxlint-failure.js";
import { loadNativeOxlintBinding } from "../runners/oxlint/load-native-oxlint-binding.js";
import { isRecord } from "../utils/is-record.js";
import type { JsxSubtreeCandidate } from "./detect-duplicate-jsx-subtrees.js";
import { parseJsxSubtreeOccurrence } from "./utils/parse-jsx-subtree-occurrence.js";

export interface NativeJsxSubtreeCandidates {
  readonly candidates: JsxSubtreeCandidate[];
  readonly limitExceeded: boolean;
}

const parseCandidate = (
  value: unknown,
  fileName: string,
  sourceLength: number,
): JsxSubtreeCandidate | null => {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((name) => name === "metadata" || name === "occurrence") ||
    !isRecord(value.metadata) ||
    !Object.keys(value.metadata).every(
      (name) => name === "fingerprint" || name === "nodeCount" || name === "depth",
    ) ||
    typeof value.metadata.fingerprint !== "string" ||
    !/^jsx:[a-f0-9]{64}$/.test(value.metadata.fingerprint) ||
    typeof value.metadata.nodeCount !== "number" ||
    !Number.isSafeInteger(value.metadata.nodeCount) ||
    value.metadata.nodeCount < 1 ||
    typeof value.metadata.depth !== "number" ||
    !Number.isSafeInteger(value.metadata.depth) ||
    value.metadata.depth < 1 ||
    value.metadata.depth > value.metadata.nodeCount
  ) {
    return null;
  }
  const occurrence = parseJsxSubtreeOccurrence(value.occurrence);
  if (
    occurrence === null ||
    occurrence.path !== fileName ||
    !Number.isSafeInteger(occurrence.startOffset) ||
    !Number.isSafeInteger(occurrence.endOffset) ||
    occurrence.startOffset < 0 ||
    occurrence.endOffset <= occurrence.startOffset ||
    occurrence.endOffset > sourceLength ||
    ![occurrence.startLine, occurrence.startColumn, occurrence.endLine, occurrence.endColumn].every(
      (position) => Number.isSafeInteger(position) && position > 0 && position <= sourceLength + 1,
    ) ||
    occurrence.endLine < occurrence.startLine ||
    (occurrence.endLine === occurrence.startLine &&
      occurrence.endColumn <= occurrence.startColumn) ||
    occurrence.compositionPath.length === 0 ||
    occurrence.compositionPath.at(-1) !== occurrence.rootName ||
    (occurrence.compositionRootStartOffset !== null &&
      (!Number.isSafeInteger(occurrence.compositionRootStartOffset) ||
        occurrence.compositionRootStartOffset < 0 ||
        occurrence.compositionRootStartOffset > occurrence.startOffset))
  ) {
    return null;
  }
  return {
    metadata: {
      fingerprint: value.metadata.fingerprint,
      nodeCount: value.metadata.nodeCount,
      depth: value.metadata.depth,
    },
    occurrence,
  };
};

export const runNativeJsxSubtreeCandidates = (
  fileName: string,
  sourceText: string,
  maximumCandidateCount: number,
): NativeJsxSubtreeCandidates | null => {
  const binding = loadNativeOxlintBinding();
  if (binding === null) return null;
  if (typeof binding.extractReactDoctorJsxSubtreeCandidates !== "function") {
    handleNativeOxlintFailure(
      "The required native Oxlint binding does not provide JSX subtree candidate extraction.",
    );
    return null;
  }
  if (!fileName.isWellFormed() || !sourceText.isWellFormed()) return null;
  let output: unknown;
  try {
    const outputJson: unknown = binding.extractReactDoctorJsxSubtreeCandidates(
      fileName,
      sourceText,
      maximumCandidateCount,
    );
    if (typeof outputJson !== "string") {
      throw new Error("Native JSX subtree candidates must be a JSON string.");
    }
    output = JSON.parse(outputJson);
  } catch (error) {
    handleNativeOxlintFailure(
      "The required native JSX subtree candidate extraction failed.",
      error,
    );
    return null;
  }
  if (isRecord(output)) {
    if (
      Object.keys(output).every((name) => name === "unsupported") &&
      Array.isArray(output.unsupported) &&
      output.unsupported.length > 0 &&
      output.unsupported.every((reason) => typeof reason === "string" && reason.length > 0)
    ) {
      return null;
    }
    if (
      Object.keys(output).every((name) => name === "candidates" || name === "limitExceeded") &&
      Array.isArray(output.candidates) &&
      typeof output.limitExceeded === "boolean" &&
      (!output.limitExceeded || output.candidates.length === 0)
    ) {
      const candidates: JsxSubtreeCandidate[] = [];
      for (const value of output.candidates) {
        const candidate = parseCandidate(value, fileName, sourceText.length);
        if (candidate === null) {
          handleNativeOxlintFailure(
            "The required native JSX subtree candidate extraction returned an invalid candidate.",
          );
          return null;
        }
        candidates.push(candidate);
      }
      return { candidates, limitExceeded: output.limitExceeded };
    }
  }
  handleNativeOxlintFailure(
    "The required native JSX subtree candidate extraction returned an invalid result.",
  );
  return null;
};
