// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic loop-carried cancellation reset regression
// verdict: fail
import { useEffect, useState } from "react";

export const Status = ({ keepGoing, load }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      while (keepGoing) {
        cancelled = false;
        if (cancelled) return;
        setValue("pending");
        await load();
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [keepGoing, load]);
  return value;
};
