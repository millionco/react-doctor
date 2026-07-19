// rule: no-mutate-then-set-or-return-same-reference
// weakness: type-proven-collection
// source: PR #1000 final precision review

import { useState } from "react";

export const Rows = ({ initialRows }: { initialRows: number[] }) => {
  const [rows, setRows] = useState<number[]>(initialRows);
  rows.push(1);
  setRows(rows);
  return null;
};
