// rule: no-ref-current-in-render
// weakness: cross-file
// source: synthetic replaced caller React provider regression
// file-path: corpus/regressions/no-ref-current-in-render--replaced-caller-factory-provider.tsx
// verdict: pass

import React, { useRef } from "react";
import { makeDefaultRenderValue } from "./local-default-render-factory";

Object.defineProperty(React, "useState", { value: () => [null] });

export const Panel = ({ value }: { value: string }) => {
  const valueRef = useRef(value);
  return makeDefaultRenderValue(() => {
    valueRef.current = value;
    return value;
  });
};
