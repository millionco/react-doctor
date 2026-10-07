// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: nishantpainter/personal-kanban src/PersonalKanban/containers/KanbanBoard/index.tsx
// verdict: pass

import { useCallback, useState } from "react";

interface Row {
  name: string;
}

export const ResolvedCloneHelper = () => {
  const [, setRows] = useState<Row[]>([]);
  const cloneRows = useCallback((rows: Row[]) => rows.map((row) => ({ ...row })), []);

  setRows((rows) => {
    const nextRows = cloneRows(rows);
    nextRows[0].name = "Ada";
    return nextRows;
  });

  return null;
};
