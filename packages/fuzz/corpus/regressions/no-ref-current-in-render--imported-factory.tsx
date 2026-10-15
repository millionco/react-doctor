// rule: no-ref-current-in-render
// weakness: cross-file
// source: synthetic local factory regression
// file-path: corpus/regressions/no-ref-current-in-render--imported-factory.tsx
// verdict: fail

import { useRef } from "react";
import { makeRenderValue } from "./local-render-factory";

export const Panel = ({ value }: { value: string }) => {
  const valueRef = useRef(value);
  return makeRenderValue(() => {
    valueRef.current = value;
    return value;
  });
};
