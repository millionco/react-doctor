// rule: effect-listener-cleanup-mismatch
// weakness: other
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = () => {
  useEffect(() => {
    const handleResize = () => undefined;
    window.addEventListener("resize", handleResize, {
      __proto__: { capture: true },
    });
    return () => window.removeEventListener("resize", handleResize, true);
  }, []);
};
