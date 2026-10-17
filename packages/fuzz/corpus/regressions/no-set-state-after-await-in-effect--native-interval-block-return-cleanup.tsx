// rule: no-set-state-after-await-in-effect
// verdict: fail
// weakness: wrapper-transparency
// source: independent synthetic fuzz regression
// file-path: packages/fuzz/corpus/regressions/no-set-state-after-await-in-effect--native-interval-block-return-cleanup.tsx
import { useEffect, useState, useReducer } from "react";

export const Panel = ({ revision, load }) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    const interval = setInterval(async () => {
      const first = await load(revision);
      setValue(first);
    }, 5000);
    return () => {
      return clearInterval(interval);
    };
  }, [revision]);
  return <output data-value={value} />;
};
