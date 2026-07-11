// rule: effect-listener-cleanup-mismatch
// weakness: control-flow
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

const releaseLayout = (): void => {};

export const useResizeListener = () => {
  useEffect(() => {
    const controller = new AbortController();
    window.addEventListener("resize", () => undefined, { signal: controller.signal });
    return () => {
      window.removeEventListener("resize", () => undefined);
      try {
        releaseLayout();
      } finally {
        controller.abort();
      }
    };
  }, []);
};
