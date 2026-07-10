// rule: effect-listener-cleanup-mismatch
// weakness: control-flow
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = (shouldAbort: boolean) => {
  useEffect(() => {
    const controller = new AbortController();
    window.addEventListener("resize", () => undefined, { signal: controller.signal });
    if (shouldAbort) {
      controller.abort();
    } else {
      controller.abort();
    }
    return () => window.removeEventListener("resize", () => undefined);
  }, [shouldAbort]);
};
