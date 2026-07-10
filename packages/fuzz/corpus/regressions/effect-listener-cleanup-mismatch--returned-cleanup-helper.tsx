// rule: effect-listener-cleanup-mismatch
// weakness: wrapper-transparency
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = () => {
  useEffect(() => {
    const handleResize = () => undefined;
    const removeListener = () => window.removeEventListener("resize", handleResize);
    const cleanup = () => {
      removeListener();
      window.removeEventListener("resize", () => undefined);
    };
    window.addEventListener("resize", handleResize);
    return cleanup;
  }, []);
};
