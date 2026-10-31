// rule: no-ref-current-in-render
// weakness: alias-guard
// source: synthetic
// verdict: pass
import { useCallback, useRef } from "react";

export const Panel = ({ value }) => {
  let container = useRef(null);
  container = { current: null };
  const receiver = container;
  const resolveValue = useCallback(() => {
    receiver.current = value;
  }, []);
  resolveValue();
  return null;
};
