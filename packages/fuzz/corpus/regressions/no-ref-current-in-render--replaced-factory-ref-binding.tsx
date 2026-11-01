// rule: no-ref-current-in-render
// weakness: alias-guard
// source: synthetic replaced ref binding regression
// file-path: corpus/regressions/no-ref-current-in-render--replaced-factory-ref-binding.tsx
// verdict: pass

import { useRef } from "react";
import { makeRenderValue } from "./local-render-factory";

export const Panel = ({ value }: { value: string }) => {
  let valueRef = useRef(value);
  [valueRef = { current: value }] = [];
  return makeRenderValue(() => {
    valueRef.current = value;
    return value;
  });
};
