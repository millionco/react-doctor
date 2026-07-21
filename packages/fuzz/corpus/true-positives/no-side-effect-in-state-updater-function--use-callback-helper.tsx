// rule: no-side-effect-in-state-updater-function
// weakness: wrapper-transparency
// source: detector contract audit
// verdict: fail

import { useCallback, useState } from "react";

interface Row {
  name: string;
}

export const UseCallbackHelper = () => {
  const [, setRows] = useState<Row[]>([]);
  const cloneRows = useCallback(
    (rows: Row[]) =>
      rows.map((row) => {
        fetch(`/track?name=${row.name}`);
        return { ...row };
      }),
    [],
  );

  setRows((rows) => cloneRows(rows));

  return null;
};
