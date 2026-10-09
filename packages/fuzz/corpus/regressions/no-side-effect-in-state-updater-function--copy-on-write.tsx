// rule: no-side-effect-in-state-updater-function
// verdict: safe
import { useState } from "react";
export const View = ({ rows }) => {
  const [, setState] = useState({ entries: {} });
  setState((previous) => {
    let copied = false;
    let next = previous.entries;
    for (const row of rows) {
      if (row.skip) continue;
      if (!copied) next = { ...next };
      next[row.key] = { value: row.value };
      copied = true;
    }
    return { ...previous, entries: next };
  });
};
