// rule: no-promise-then-side-effect-in-effect-without-catch
// verdict: pass
// weakness: default-parameter
// source: synthetic
import { useEffect, useState, useRef } from "react";
class Setup {
  constructor(public value = (globalThis.fetch = () => Promise.resolve("ok"))) {}
}
new Setup();
export const Example = () => {
  const [value, setValue] = useState<unknown>(null);
  useEffect(() => {
    (async () => {
      fetch("/value").then(setValue);
    })();
  }, []);
  return null;
};
