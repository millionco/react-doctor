import { isRecord } from "../../utils/is-record.js";
import type { DuplicateJsxSubtreeOccurrence } from "../detect-duplicate-jsx-subtrees.js";

export const parseJsxSubtreeOccurrence = (value: unknown): DuplicateJsxSubtreeOccurrence | null => {
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
