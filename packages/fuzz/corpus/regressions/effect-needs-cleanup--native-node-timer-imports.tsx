// rule: effect-needs-cleanup
// weakness: library-idiom
// source: synthetic
import { clearInterval, setInterval } from "node:timers";
import { useEffect } from "react";

export const Clock = ({ refresh }: { refresh: () => void }) => {
  useEffect(() => {
    const timer = setInterval(refresh, 100);
    return () => clearInterval(timer);
  }, [refresh]);
  return null;
};
