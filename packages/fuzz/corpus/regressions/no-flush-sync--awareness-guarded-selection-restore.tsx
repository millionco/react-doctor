// rule: no-flush-sync
// weakness: library-idiom
// source: react-bench write-react-softmaple-softmaple q73E2SU

import { useTextareaSelectionSync } from "@softmaple/awareness/hooks";
import { flushSync } from "react-dom";

export const commitRemoteOperations = (
  textarea: HTMLTextAreaElement,
  operations: readonly unknown[],
): void => {
  const selectionSync = useTextareaSelectionSync({ current: textarea });
  const selection = selectionSync.captureSelection();
  const mergedText = readRemoteText();
  flushSync(() => {
    setText(mergedText);
  });
  if (!selection || operations.length === 0) {
    return;
  }
  selectionSync.restoreSelection(selection);
};
