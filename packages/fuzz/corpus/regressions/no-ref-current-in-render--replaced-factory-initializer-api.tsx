// rule: no-ref-current-in-render
// weakness: cross-file
// source: synthetic replaced imported helper initializer regression
// file-path: corpus/regressions/no-ref-current-in-render--replaced-factory-initializer-api.tsx
// verdict: pass

import { useRef } from "react";
import { makeReplacedInitializerValue } from "./local-unsupported-render-factories";

export const Panel = ({ value }: { value: string }) => {
  const valueRef = useRef(value);
  return makeReplacedInitializerValue(() => {
    valueRef.current = value;
    return value;
  });
};
