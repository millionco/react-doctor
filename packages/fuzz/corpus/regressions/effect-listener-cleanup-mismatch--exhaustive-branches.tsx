// rule: effect-listener-cleanup-mismatch
// weakness: control-flow
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = (isEnabled: boolean) => {
  useEffect(() => {
    const handleResize = () => undefined;
    window.addEventListener("resize", handleResize);
    return () => {
      if (isEnabled) {
        window.removeEventListener("resize", handleResize);
      } else {
        window.removeEventListener("resize", handleResize);
      }
      window.removeEventListener("resize", () => undefined);
    };
  }, [isEnabled]);
};
