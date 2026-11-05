// rule: effect-needs-cleanup
// weakness: library-idiom
// source: synthetic
import { setInterval } from "node:timers";
import { useEffect } from "react";

export const Clock = ({ refresh }: { refresh: () => void }) => {
  useEffect(() => {
    const timer = setInterval(() => refresh(), 1000);
    return () => timer[Symbol.dispose]();
  }, [refresh]);
  return null;
};
