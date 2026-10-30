// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: control-flow
// source: synthetic

import { useCallback, useRef, useState } from "react";

export const ImmediateRefGuard = () => {
  const gate = useRef(false);
  const [value, setValue] = useState(0);
  const reset = () => fetch("/reset");
  const visit = useCallback(() => {
    if (!gate.current) reset();
  }, []);
  const update = () =>
    setValue((previous) => {
      if (gate.current) visit();
      return previous + 1;
    });
  return <button onClick={update}>{value}</button>;
};
