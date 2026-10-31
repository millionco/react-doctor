// rule: no-ref-current-in-render
// weakness: default-parameter
// source: synthetic callback and helper input regression
// file-path: corpus/regressions/no-ref-current-in-render--input-controlled-factory.tsx
// verdict: pass

import { useRef } from "react";
import { makeConditionalValue, makeInputValue } from "./local-unsupported-render-factories";

export const Panel = ({ value }: { value: string }) => {
  const valueRef = useRef(value);
  makeConditionalValue(() => {
    valueRef.current = value;
    return value;
  }, false);
  makeInputValue((enabled = false) => {
    if (enabled) valueRef.current = value;
    return value;
  });
  return null;
};
