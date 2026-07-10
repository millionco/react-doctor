// rule: effect-listener-cleanup-mismatch
// weakness: alias-guard
// source: PR #1110 FP fuzzing

import { useEffect } from "react";

export const useChangeListener = () => {
  useEffect(() => {
    const holder = { current: new EventTarget() };
    const originalTarget = holder.current;
    const handleChange = () => undefined;
    holder.current.addEventListener("change", handleChange);
    holder.current = new EventTarget();
    return () => {
      originalTarget.removeEventListener("change", handleChange);
      holder.current.removeEventListener("change", () => undefined);
    };
  }, []);
};
