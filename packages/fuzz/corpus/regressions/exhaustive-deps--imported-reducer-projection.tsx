// rule: exhaustive-deps
// weakness: cross-file
// source: synthetic destructured dispatch-only callback
// file-path: corpus/regressions/exhaustive-deps--imported-reducer-projection.tsx
// verdict: pass
import { useEffect } from "react";
import { useCounterDispatch } from "./support/use-counter-dispatch.js";

export const Counter = () => {
  const { count, increment } = useCounterDispatch();
  useEffect(() => {
    increment(1);
  }, []);
  return <output>{count}</output>;
};
