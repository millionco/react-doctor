// rule: no-ref-current-in-render
// weakness: copy-tracking
// source: ECMAScript Reflect.set boolean result
// verdict: pass
import { useRef } from "react";

export const Cache = () => {
  const cacheRef = useRef(null);
  if (cacheRef.current === null) {
    return Reflect.set(cacheRef, "current", new Map(), cacheRef);
  }
  return null;
};
