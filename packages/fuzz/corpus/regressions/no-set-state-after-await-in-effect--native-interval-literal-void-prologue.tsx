// rule: no-set-state-after-await-in-effect
// verdict: fail
// weakness: wrapper-transparency
// source: independent synthetic fuzz regression
// file-path: packages/fuzz/corpus/regressions/no-set-state-after-await-in-effect--native-interval-literal-void-prologue.tsx
import { useEffect, useState, useReducer } from "react";

export const Panel = ({ revision, load }) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    void 0;
    const interval = setInterval(async () => {
      const first = await load(revision);
      setValue(first);
    }, 5000);
    return () => clearInterval(interval);
  }, [revision]);
  return <output data-value={value} />;
};
