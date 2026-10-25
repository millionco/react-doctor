// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic abrupt finally completion
// verdict: fail
import { useEffect, useState } from "react";

export const Status = ({ itemId, load }) => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const run = async () => {
      try {
        await load(itemId);
        return;
      } finally {
        setValue(1);
      }
    };
    void run();
  }, [itemId, load]);
  return value;
};
