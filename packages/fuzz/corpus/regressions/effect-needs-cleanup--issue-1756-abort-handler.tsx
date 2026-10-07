// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: issue #1756
// verdict: pass
import { useEffect } from "react";

export const AbortHandlerCleanup = () => {
  useEffect(() => {
    const controller = new AbortController();
    const onChange = () => {};
    document.addEventListener("visibilitychange", onChange);
    controller.signal.addEventListener("abort", () => {
      document.removeEventListener("visibilitychange", onChange);
    });
    return () => controller.abort();
  }, []);
  return null;
};
