// rule: no-fetch-in-effect
// weakness: name-heuristic
// source: independently synthetic immediate IIFE binding/provider regression
// verdict: fail

import { useEffect, useState, useRef } from "react";
interface useEffect {}
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
