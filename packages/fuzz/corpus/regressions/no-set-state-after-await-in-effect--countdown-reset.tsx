// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic finite countdown reset regression
// verdict: fail
import { useEffect, useState } from "react";

export const Status = ({ load }) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      let remaining = 2;
      while (remaining > 0) {
        cancelled = false;
        await load();
        remaining -= 1;
      }
      if (cancelled) return;
      setValue("done");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);
  return value;
};
