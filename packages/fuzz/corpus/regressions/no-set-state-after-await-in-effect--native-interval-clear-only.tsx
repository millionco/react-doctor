// rule: no-set-state-after-await-in-effect
// weakness: native-timer-async-continuation
// source: independent synthetic regression
// verdict: fail
import { useEffect, useState } from "react";
export const useIntervalValue = (revision: string, load: (key: string) => Promise<string>) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    const interval = setInterval(async () => {
      const next = await load(revision);
      setValue(next);
    }, 1000);
    return () => clearInterval(interval);
  }, [revision, load]);
  return value;
};
