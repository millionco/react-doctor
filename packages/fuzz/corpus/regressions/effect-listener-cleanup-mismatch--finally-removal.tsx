// rule: effect-listener-cleanup-mismatch
// weakness: control-flow
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

const releaseLayout = (): void => {};

export const useResizeListener = () => {
  useEffect(() => {
    const handleResize = () => undefined;
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", () => undefined);
      try {
        releaseLayout();
      } finally {
        window.removeEventListener("resize", handleResize);
      }
    };
  }, []);
};
