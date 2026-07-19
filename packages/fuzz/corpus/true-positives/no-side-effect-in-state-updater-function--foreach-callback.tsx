// rule: no-side-effect-in-state-updater-function
// weakness: callback-argument
// source: PR #1000 final precision review

import { useState } from "react";

export const Rows = ({ onVisit }: { onVisit: (row: number) => void }) => {
  const [, setRows] = useState<number[]>([]);
  setRows((rows) => {
    rows.forEach(onVisit);
    return rows;
  });
  return null;
};
