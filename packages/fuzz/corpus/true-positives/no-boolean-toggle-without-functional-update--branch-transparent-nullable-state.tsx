// rule: no-boolean-toggle-without-functional-update
// weakness: mutation-verdict
// source: Synthetic transparent nullable state provider
// verdict: fail
import { useEffect, useState } from "react";
export const Example = () => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(false as boolean);
  const [target, setTarget] = useState(null as null);
  const changeMode = () => setMode(!mode);
  useEffect(() => {
    const nativeTarget = new EventTarget();
    (setTarget as any)(nativeTarget as EventTarget);
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
