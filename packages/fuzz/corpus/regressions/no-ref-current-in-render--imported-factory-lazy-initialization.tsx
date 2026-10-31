// rule: no-ref-current-in-render
// weakness: cross-file
// source: synthetic local factory regression
// file-path: corpus/regressions/no-ref-current-in-render--imported-factory-lazy-initialization.tsx
// verdict: pass

import { useRef } from "react";
import { makeRenderValue } from "./local-render-factory";

export const Panel = () => {
  const valueRef = useRef<Map<string, string> | null>(null);
  return makeRenderValue(() => {
    if (valueRef.current === null) valueRef.current = new Map();
    return null;
  });
};
