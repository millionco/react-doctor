// rule: effect-listener-cleanup-mismatch
// weakness: control-flow
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = (shouldAbort: boolean) => {
  useEffect(() => {
    const controller = new AbortController();
    const handleResize = () => undefined;
    window.addEventListener("resize", handleResize, { signal: controller.signal });
    return () => {
      if (shouldAbort) {
        controller.abort();
      } else {
        window.removeEventListener("resize", handleResize);
      }
      window.removeEventListener("resize", () => undefined);
    };
  }, [shouldAbort]);
};
