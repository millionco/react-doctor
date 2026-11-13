// rule: no-set-state-after-await-in-effect
// weakness: native-timer-async-continuation
// source: independent synthetic regression
// verdict: pass
import { useEffect, useState } from "react";
export const useIntervalValue = (revision: string, load: (key: string) => Promise<string>) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(async () => {
      const next = await load(revision);
      if (cancelled) return;
      setValue(next);
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [revision, load]);
  return value;
};
