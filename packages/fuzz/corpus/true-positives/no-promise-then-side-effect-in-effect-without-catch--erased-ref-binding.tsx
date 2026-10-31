// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: name-heuristic
// source: independently synthetic immediate IIFE binding/provider regression
// verdict: fail

import { useEffect, useState, useRef } from "react";
export const Example = () => {
  const valueRef = useRef<unknown>(null);
  interface valueRef {}
  useEffect(() => {
    (async () => {
      fetch("/value").then((response) => {
        valueRef.current = response;
      });
    })();
  }, []);
  return null;
};
