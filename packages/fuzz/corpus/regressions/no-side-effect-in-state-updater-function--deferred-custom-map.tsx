// rule: no-side-effect-in-state-updater-function
// weakness: callback-timing
// source: PR #1000 final precision review

import { useState } from "react";

export const Rows = ({ onVisit }: { onVisit: (row: number) => void }) => {
  const [, setRows] = useState<number[]>([]);
  const queue = {
    map(callback: () => void) {
      setTimeout(callback, 0);
      return [];
    },
  };
  setRows(() => queue.map(() => onVisit(1)));
  return null;
};
