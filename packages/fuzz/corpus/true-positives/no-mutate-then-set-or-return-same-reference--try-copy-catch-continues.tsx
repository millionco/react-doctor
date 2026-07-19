// rule: no-mutate-then-set-or-return-same-reference
// weakness: exceptional-control-flow
// source: Cursor Bugbot review on PR #1383

import { useState } from "react";

export const Rows = () => {
  const [rows, setRows] = useState<number[]>([]);
  const append = () =>
    setRows((previousRows) => {
      try {
        previousRows = [...previousRows];
      } catch {}
      previousRows.push(1);
      return previousRows;
    });
  return <button onClick={append}>{rows.length}</button>;
};
