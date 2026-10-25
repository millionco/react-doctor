// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic abrupt finally completion
// verdict: pass
import { useEffect, useState } from "react";

export const Status = ({ itemId, load }) => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await load(itemId);
        return;
      } finally {
        if (!cancelled) setValue(1);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [itemId, load]);
  return value;
};
