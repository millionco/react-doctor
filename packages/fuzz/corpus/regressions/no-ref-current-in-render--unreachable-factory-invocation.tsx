// rule: no-ref-current-in-render
// weakness: cross-file
// source: synthetic imported helper invocation regression
// file-path: corpus/regressions/no-ref-current-in-render--unreachable-factory-invocation.tsx
// verdict: pass

import { useRef } from "react";
import { makeUnreachableValue } from "./local-unsupported-render-factories";

export const Panel = ({ value }: { value: string }) => {
  const valueRef = useRef(value);
  return makeUnreachableValue(() => {
    valueRef.current = value;
    return value;
  });
};
