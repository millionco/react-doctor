// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: synthetic cached while-condition regression
// verdict: fail
import { useEffect, useState } from "react";

export const Status = ({ keepGoing, load }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const alive = !cancelled;
    const run = async () => {
      while (alive && keepGoing) {
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
