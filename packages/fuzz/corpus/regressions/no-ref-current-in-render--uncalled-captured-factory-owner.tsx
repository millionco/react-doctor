// rule: no-ref-current-in-render
// weakness: name-heuristic
// source: synthetic uncalled captured ref owner regression
// file-path: corpus/regressions/no-ref-current-in-render--uncalled-captured-factory-owner.tsx
// verdict: pass

import { useRef } from "react";
import { makeRenderValue } from "./local-render-factory";

export const Panel = ({ value }: { value: string }) => {
  const valueRef = useRef(value);
  const Unused = () =>
    makeRenderValue(() => {
      valueRef.current = value;
      return value;
    });
  const useUnused = () =>
    makeRenderValue(() => {
      valueRef.current = value;
      return value;
    });
  return null;
};
