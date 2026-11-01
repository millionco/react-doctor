// rule: no-boolean-toggle-without-functional-update
// weakness: mutation-verdict
// source: synthetic legacy Object native method getter replacement
// verdict: pass
// oxfmt-ignore
const syncRegistrar = (_event, callback) => callback();
Object.prototype.__defineGetter__.call(window, "addEventListener", () => syncRegistrar);
import { useEffect, useState } from "react";
export const Example = ({ mode }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let listener;
    if (mode) {
      listener = () => {};
    } else {
      listener = () => setOpen(!open);
    }
    window.addEventListener("change", listener);
    return () => window.removeEventListener("change", listener);
  }, [mode]);
  return <output>{String(open)}</output>;
};
