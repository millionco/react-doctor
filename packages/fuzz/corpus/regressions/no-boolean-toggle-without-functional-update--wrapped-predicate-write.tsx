// rule: no-boolean-toggle-without-functional-update
// weakness: mutation-verdict
// source: synthetic wrapped predicate write
// verdict: pass
// oxfmt-ignore
import { useEffect, useState } from "react";
export const Example = ({ mode }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    (mode as any) = true;
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
