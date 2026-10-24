// rule: exhaustive-deps
// weakness: cross-file
// source: synthetic setter-only imported member
// file-path: corpus/regressions/exhaustive-deps--imported-setter-member.tsx
// verdict: pass
import { useEffect } from "react";
import { useCounterActions } from "./support/use-counter-actions.js";

export const Counter = () => {
  const actions = useCounterActions();
  useEffect(() => {
    actions.increment(1);
  }, []);
  return <output>{actions.read()}</output>;
};
