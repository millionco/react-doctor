// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: handwritten native parity regression
// verdict: pass

import { useEffect } from "react";

export const OwnedListenerTimer = ({ element }: { element: HTMLElement }) => {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };
    const handleBlur = () => {
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
      }, 100);
    };
    element.addEventListener("blur", handleBlur);
    return () => {
      clearTimer();
      element.removeEventListener("blur", handleBlur);
    };
  }, [element]);
  return null;
};
