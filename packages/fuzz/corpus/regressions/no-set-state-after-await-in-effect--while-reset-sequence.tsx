// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic loop-carried sequence reset regression
// verdict: fail
import { useEffect, useState } from "react";

export const Status = ({ keepGoing, load }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    const run = async () => {
      let sequence = 0;
      let request = ++sequence;
      while (keepGoing) {
        request = sequence;
        await load();
        if (request !== sequence) return;
        setValue("pending");
        await load();
      }
    };
    void run();
  }, [keepGoing, load]);
  return value;
};
