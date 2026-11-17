// rule: no-boolean-toggle-without-functional-update
// weakness: runtime-context
// source: Synthetic native state provider with actual host context
// verdict: fail
import { useEffect, useState } from "react";
export const Example = () => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(false);
  const [target, setTarget] = useState(null);
  const changeMode = () => setMode(!mode);
  useEffect(() => {
    const nativeTarget = new EventTarget();
    setTarget(nativeTarget);
  }, []);
  useEffect(() => {
    if (target) {
      let listener;
      if (mode) {
        listener = () => {};
      } else {
        listener = () => setOpen(!open);
      }
      target.addEventListener("change", listener);
      return () => target.removeEventListener("change", listener);
    }
  }, [mode, target]);
  return <button onClick={changeMode}>{String(open)}</button>;
};
