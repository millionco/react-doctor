// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: dynamic-computed
// source: independently synthetic immediate IIFE binding/provider regression
// verdict: pass

import { useEffect, useState, useRef } from "react";
const prototypeKey = "prototype";
Promise[prototypeKey].then = () => null;
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
