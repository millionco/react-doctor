// rule: no-flush-sync
// weakness: library-idiom
// source: react-bench write-react-softmaple-softmaple jGcM6e2

import { useTextareaSelectionSync } from "@softmaple/awareness/hooks";
import { flushSync } from "react-dom";

export const runReplicaChange = (textarea: HTMLTextAreaElement): void => {
  const selectionSync = useTextareaSelectionSync({ current: textarea });
  const selection = selectionSync.captureSelection();
  flushSync(() => {
    setText(readRemoteText());
    selectionSync.restoreSelection(selection);
  });
};
