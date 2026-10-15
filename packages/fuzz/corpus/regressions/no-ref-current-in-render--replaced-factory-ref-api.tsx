// rule: no-ref-current-in-render
// weakness: alias-guard
// source: synthetic replaced React ref API regression
// file-path: corpus/regressions/no-ref-current-in-render--replaced-factory-ref-api.tsx
// verdict: pass

import React from "react";
import { makeRenderValue } from "./local-render-factory";

Object.assign(React, { useRef: () => ({ current: "" }) });

export const Panel = ({ value }: { value: string }) => {
  const valueRef = React.useRef(value);
  return makeRenderValue(() => {
    valueRef.current = value;
    return value;
  });
};
