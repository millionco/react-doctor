// rule: no-side-effect-in-state-updater-function
// weakness: receiver-provenance
// source: PR #1000 final precision review

import { useState } from "react";

export const Rows = ({ onVisit }: { onVisit: (row: number) => void }) => {
  const [, setRows] = useState<number[]>([]);
  setRows((rows) => {
    const callbacks = { onVisit };
    callbacks.onVisit(rows[0] ?? 0);
    return rows;
  });
  return null;
};
