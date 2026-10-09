// rule: no-ref-current-in-render
// verdict: pass
// weakness: a local assignment hides deterministic null-guarded initialization
// source: reduced local regression
import { useRef } from "react";
export const Panel = () => {
  const cache = useRef(null);
  let instance;
  if (cache.current === null) {
    instance = { value: null };
    cache.current = instance;
  } else {
    instance = cache.current;
  }
  return null;
};
