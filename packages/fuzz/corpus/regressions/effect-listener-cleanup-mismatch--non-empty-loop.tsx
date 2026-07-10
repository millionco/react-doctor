// rule: effect-listener-cleanup-mismatch
// weakness: control-flow
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = () => {
  useEffect(() => {
    const handleResize = () => undefined;
    window.addEventListener("resize", handleResize);
    return () => {
      for (const cleanupListener of [handleResize]) {
        window.removeEventListener("resize", cleanupListener);
      }
      window.removeEventListener("resize", () => undefined);
    };
  }, []);
};
