// rule: effect-listener-cleanup-mismatch
// weakness: wrapper-transparency
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = () => {
  useEffect(() => {
    const controller = new AbortController();
    const abortListener = controller.abort.bind(controller);
    window.addEventListener("resize", () => undefined, { signal: controller.signal });
    return () => {
      window.removeEventListener("resize", () => undefined);
      abortListener();
    };
  }, []);
};
