// rule: no-side-effect-in-state-updater-function
// file-path: corpus/true-positives/returned-scheduler-erased-window/no-side-effect-in-state-updater-function--erased-window-returned-scheduler.tsx
// verdict: fail
// weakness: name-heuristic
// source: synthetic

import { useState } from "react";
import { useQueue } from "./queue";
export const Example = () => {
  const [value, setValue] = useState(0);
  const queue = useQueue(() => {});
  return (
    <button
      onClick={() =>
        setValue((previous) => {
          queue();
          return previous + 1;
        })
      }
    >
      {value}
    </button>
  );
};
