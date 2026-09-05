// rule: effect-needs-cleanup
// weakness: async-lifecycle-provenance
// source: issue #1756
// verdict: pass
import { useEffect } from "react";

declare const refresh: () => Promise<void>;

export const GuardedAsyncTimer = () => {
  useEffect(() => {
    const run = { live: true };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      timer = setTimeout(() => {}, 1000);
    };
    void (async () => {
      await refresh();
      if (!run.live) return;
      schedule();
    })();
    return () => {
      run.live = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  return null;
};
