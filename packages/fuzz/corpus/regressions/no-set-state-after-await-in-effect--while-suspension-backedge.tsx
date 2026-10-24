// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic ordinary while backedge regression
// verdict: fail
import { useEffect, useState } from "react";

export const Status = ({ keepGoing, load }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    const run = async () => {
      while (keepGoing) {
        setValue("pending");
        await load();
      }
    };
    void run();
  }, [keepGoing, load]);
  return value;
};
