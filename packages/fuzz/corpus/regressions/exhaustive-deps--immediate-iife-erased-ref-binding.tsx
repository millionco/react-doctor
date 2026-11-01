// rule: exhaustive-deps
// weakness: name-heuristic
// source: independently synthetic immediate IIFE binding/provider regression
// verdict: pass

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
