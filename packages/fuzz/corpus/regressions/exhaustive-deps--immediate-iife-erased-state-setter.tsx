// rule: exhaustive-deps
// weakness: name-heuristic
// source: independently synthetic immediate IIFE binding/provider regression
// verdict: pass

import { useEffect, useState, useRef } from "react";
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  interface setValue {}
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
