// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic ordinary while cancellation regression
// verdict: pass
import { useEffect, useState } from "react";

export const Status = ({ keepGoing, load }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      while (keepGoing) {
        const nextValue = await load();
        if (cancelled) return;
        setValue(nextValue);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [keepGoing, load]);
  return value;
};
