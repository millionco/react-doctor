// rule: no-ref-current-in-render
// weakness: cross-file
// source: synthetic unsupported genuine caller boundary scope control
// file-path: corpus/regressions/no-ref-current-in-render--unsupported-factory-caller-boundaries.tsx
// verdict: pass

import { useRef, useState } from "react";
import { makeRenderValue } from "./local-render-factory";

export const Panel = ({ value }: { value: string }) => {
  const valueRef = useRef(value);
  (() =>
    makeRenderValue(() => {
      valueRef.current = value;
      return value;
    }))();
  useState(() =>
    makeRenderValue(() => {
      valueRef.current = value;
      return value;
    }),
  );
  return null;
};
