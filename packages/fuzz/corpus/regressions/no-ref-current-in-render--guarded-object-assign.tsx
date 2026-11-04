// rule: no-ref-current-in-render
// weakness: library-idiom
// source: PR #2310 review
// verdict: pass
import { useRef } from "react";

export const CachedValue = () => {
  const valueRef = useRef(null);
  if (valueRef.current === null) Object.assign(valueRef, { current: new Map() });
  return null;
};
