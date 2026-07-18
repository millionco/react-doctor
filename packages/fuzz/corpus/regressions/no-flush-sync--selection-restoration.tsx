// rule: no-flush-sync
// weakness: imperative-post-commit-handoff
// source: react-bench write-react-softmaple-softmaple gxWkbFm

import { flushSync } from "react-dom";

interface SelectionSync {
  restoreSelection: (selection: { end: number; start: number }) => void;
}

export const acceptRemoteText = (
  selectionSync: SelectionSync,
  selection: { end: number; start: number } | null,
): void => {
  flushSync(() => {
    setText(readRemoteText());
  });
  if (selection) {
    selectionSync.restoreSelection(selection);
  }
};
