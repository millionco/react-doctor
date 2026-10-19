// rule: no-promise-then-side-effect-in-effect-without-catch
// weakness: provider-mutation
// source: independently synthetic immediate IIFE binding/provider regression
// verdict: pass

import { useEffect, useState, useRef } from "react";
interface Promise {}
const NativePromise = Promise;
NativePromise.prototype.then = () => null;
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
