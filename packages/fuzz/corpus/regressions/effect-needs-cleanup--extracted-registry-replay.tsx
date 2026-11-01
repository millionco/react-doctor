// rule: effect-needs-cleanup
// weakness: helper-indirection
// source: PR #1899 integration fuzz seed 1000392
// verdict: pass
import { useEffect } from "react";
export const CleanupRegistry = ({ targets }) => {
  useEffect(() => {
    const cleanups = [];
    for (const target of targets) {
      const handler = () => undefined;
      target.addEventListener("change", handler);
      cleanups.push(() => target.removeEventListener("change", handler));
    }
    const release = () => cleanups.forEach((cleanup) => cleanup());
    return () => release();
  }, [targets]);
  return null;
};
