// rule: no-ref-current-in-render
// verdict: fail
// weakness: competing-render-write
// source: Bugbot PR #1497

import { useMemo, useRef } from "react";

export const Panel = () => {
  const cacheRef = useRef<Map<string, string> | null>(null);
  if (cacheRef.current === null) cacheRef.current = new Map();
  useMemo(() => {
    cacheRef.current = new Map([["ready", "yes"]]);
    return cacheRef.current;
  }, []);
  return null;
};
