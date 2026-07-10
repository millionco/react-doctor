// rule: effect-listener-cleanup-mismatch
// weakness: control-flow
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = () => {
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    window.addEventListener("resize", () => undefined, { signal });
    return () => {
      window.removeEventListener("resize", () => undefined);
      if (!signal.aborted) controller.abort();
    };
  }, []);
};
