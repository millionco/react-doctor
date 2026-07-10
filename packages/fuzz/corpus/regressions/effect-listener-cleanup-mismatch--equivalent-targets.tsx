// rule: effect-listener-cleanup-mismatch
// weakness: alias-guard
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useResizeListener = () => {
  useEffect(() => {
    const targets = { first: window, second: window };
    const handleResize = () => undefined;
    targets.first.addEventListener("resize", handleResize);
    targets.second.addEventListener("resize", handleResize);
    return () => {
      targets.first.removeEventListener("resize", () => undefined);
      targets.second.removeEventListener("resize", handleResize);
    };
  }, []);
};
