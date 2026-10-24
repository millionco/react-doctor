// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic while getter guard-reset regression
// verdict: fail
import { useEffect, useState } from "react";

export const Status = ({ keepGoing, load }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const resets = {
      get value() {
        cancelled = false;
        return 0;
      },
    };
    const run = async () => {
      while (keepGoing) {
        await load();
        void resets.value;
        if (cancelled) return;
        setValue("pending");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [keepGoing, load]);
  return value;
};
