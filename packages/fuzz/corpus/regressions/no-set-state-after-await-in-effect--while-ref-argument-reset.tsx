// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: synthetic while ref-argument reset control
// verdict: fail
import { useEffect, useRef, useState } from "react";

export const Status = ({ keepGoing, load }) => {
  const [value, setValue] = useState(null);
  const cancelled = useRef(false);
  useEffect(() => {
    const reset = (flag) => {
      flag.current = false;
    };
    const run = async () => {
      while (keepGoing) {
        reset(cancelled);
        await load();
        if (cancelled.current) return;
        setValue("pending");
        await load();
      }
    };
    void run();
    return () => {
      cancelled.current = true;
    };
  }, [keepGoing, load]);
  return value;
};
