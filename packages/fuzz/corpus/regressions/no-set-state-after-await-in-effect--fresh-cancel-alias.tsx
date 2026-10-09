// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: independently authored fresh cancellation snapshot regression
import { useEffect, useState } from "react";
export const Panel = ({ load }) => {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const data = await load();
      const stale = cancelled;
      if (stale) return;
      setValue(data);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [load]);
  return <div>{value}</div>;
};
