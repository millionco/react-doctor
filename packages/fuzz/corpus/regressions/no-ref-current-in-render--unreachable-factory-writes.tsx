// rule: no-ref-current-in-render
// weakness: control-flow
// source: synthetic supplied callback reachability regression
// file-path: corpus/regressions/no-ref-current-in-render--unreachable-factory-writes.tsx
// verdict: pass

import { useRef } from "react";
import { makeRenderValue } from "./local-render-factory";

export const Panel = ({ value }: { value: string }) => {
  const valueRef = useRef(value);
  makeRenderValue(() => {
    if (false) valueRef.current = value;
    if (0n) valueRef.current = value;
    if (!true) valueRef.current = value;
    const enabled = false;
    if (enabled) valueRef.current = value;
    return value;
    valueRef.current = value;
  });
  return null;
};
