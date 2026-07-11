// rule: effect-listener-cleanup-mismatch
// weakness: wrapper-transparency
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = () => {
  useEffect(() => {
    const handleResize = () => undefined;
    const { removeEventListener } = window;
    window.addEventListener("resize", handleResize);
    return () => {
      removeEventListener.call(window, "resize", handleResize);
      window.removeEventListener("resize", () => undefined);
    };
  }, []);
};
