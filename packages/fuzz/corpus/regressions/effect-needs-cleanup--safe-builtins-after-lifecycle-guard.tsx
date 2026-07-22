// rule: effect-needs-cleanup
// verdict: pass
// weakness: control-flow
// source: https://github.com/millionco/react-doctor/pull/1422

import { useEffect } from "react";

export const DelayedTask = ({ load }: { load: () => Promise<void> }) => {
  useEffect(() => {
    const startedAt = performance.now();
    let isActive = true;
    let timeoutId: ReturnType<typeof setTimeout>;
    load().then(() => {
      if (!isActive) return;
      console.info(Math.round(performance.now() - startedAt));
      timeoutId = setTimeout(task, Math.round(performance.now() - startedAt));
    });
    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [load]);

  return null;
};
