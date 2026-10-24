// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic finite countdown zero regression
// verdict: pass
import { useEffect, useState } from "react";

export const Status = ({ load }) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    const run = async () => {
      let remaining = 0;
      while (remaining > 0) {
        setValue("pending");
        await load();
        remaining -= 1;
      }
    };
    void run();
  }, [load]);
  return value;
};
