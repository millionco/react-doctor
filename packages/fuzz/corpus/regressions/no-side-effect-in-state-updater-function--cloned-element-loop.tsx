// rule: no-side-effect-in-state-updater-function
// weakness: copy-tracking
// source: saved candidate audit, force simulation of copied nodes
// verdict: pass
import { useState } from "react";
function move(rows: { x: number }[]) {
  for (const row of rows) row.x += 1;
}
export const View = () => {
  const [, setRows] = useState<{ x: number }[]>([]);
  setRows((previous) => {
    const next = previous.map((row) => ({ ...row }));
    move(next);
    return next;
  });
  return null;
};
