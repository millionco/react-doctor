// rule: no-ref-current-in-render
// verdict: pass
// weakness: invocation-local mutable bindings do not affect object initialization
// source: independent synthetic regression
import { useRef } from "react";

export const Counter = () => {
  const valueRef = useRef<{ read: () => number } | null>(null);
  if (valueRef.current === null) {
    valueRef.current = {
      read: () => {
        let count = 0;
        count += 1;
        return count;
      },
    };
  }
  return null;
};
