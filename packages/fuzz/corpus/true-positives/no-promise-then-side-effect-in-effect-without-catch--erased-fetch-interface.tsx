// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: name-heuristic
// source: independently synthetic immediate IIFE binding/provider regression
// verdict: fail

import { useEffect, useState, useRef } from "react";
interface fetch {}
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
