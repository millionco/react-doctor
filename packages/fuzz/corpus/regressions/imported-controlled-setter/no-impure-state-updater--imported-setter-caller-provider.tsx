// rule: no-impure-state-updater
// weakness: cross-file
// source: synthetic installed dependency control, contextual replay in imported-controlled-setter-fuzz.test.ts
// verdict: pass
import { useControlledState } from "@rc-component/util";
import React from "react";
React.useState = replacement;
const Panel = () => {
  const [value, updateValue] = useControlledState(0);
  updateValue((previous) => {
    queueMicrotask(() => notify());
    return previous;
  });
  return null;
};
