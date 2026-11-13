// rule: no-side-effect-in-state-updater-function
// file-path: corpus/regressions/no-side-effect-in-state-updater-function--commonjs-export-replacement.tsx
// verdict: pass
// weakness: alias-guard
// source: synthetic

import { useState } from "react";
import { setCookie } from "./cookie-write-commonjs-provider/persist.cts";
export const Preference = () => {
  const [count, setCount] = useState(0);
  return (
    <button
      onClick={() =>
        setCount((previous) => {
          setCookie("view", "compact");
          return previous + 1;
        })
      }
    >
      {count}
    </button>
  );
};
