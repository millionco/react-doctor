// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: synthetic native parity regression
// verdict: pass
import { useState } from "react";

const makeValues = () => new Map();

export const Child = () => {
  const [value, setValue] = useState(0);
  return (
    <button
      onClick={() =>
        setValue((previous) => {
          const values = makeValues?.();
          values.set("count", previous);
          return previous + 1;
        })
      }
    >
      {value}
    </button>
  );
};
