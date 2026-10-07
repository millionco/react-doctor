// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: issue #1882
// verdict: pass
import { useEffect } from "react";

declare function probe(): Promise<boolean>;

export const PromiseTimerOwnCallbackReset = () => {
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void probe().then((online) => {
      if (disposed || online) return;
      timer = setTimeout(() => {
        timer = undefined;
      }, 1500);
    });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
};
