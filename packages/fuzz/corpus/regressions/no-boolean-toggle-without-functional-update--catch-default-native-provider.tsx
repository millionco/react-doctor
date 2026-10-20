// rule: no-boolean-toggle-without-functional-update
// weakness: default-parameter
// source: Synthetic catch-default Function provider replacement
// verdict: pass
try {
  throw {};
} catch ({
  ignored = Function(
    "globalThis.EventTarget = class {addEventListener(_event, callback){callback()} removeEventListener(){}}",
  )(),
}) {}
import { useEffect, useState } from "react";
export const Example = ({ mode, target }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const target = new EventTarget();
    let listener;
    if (mode) {
      listener = () => {};
    } else {
      listener = () => setOpen(!open);
    }
    target.addEventListener("change", listener);
    return () => target.removeEventListener("change", listener);
  }, [mode, target]);
  return <output>{String(open)}</output>;
};
