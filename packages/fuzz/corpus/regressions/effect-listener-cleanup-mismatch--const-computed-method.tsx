// rule: effect-listener-cleanup-mismatch
// weakness: dynamic-computed
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = () => {
  useEffect(() => {
    const handleResize = () => undefined;
    const removalMethod = "removeEventListener";
    window.addEventListener("resize", handleResize);
    return () => {
      window[removalMethod]("resize", handleResize);
      window.removeEventListener("resize", () => undefined);
    };
  }, []);
};
