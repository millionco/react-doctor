// rule: no-boolean-toggle-without-functional-update
// weakness: mutation-verdict
// source: Synthetic transparent local listener arguments
// verdict: fail
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
    window.addEventListener("change", listener as any);
    return () => window.removeEventListener("change", listener as any);
  }, [mode]);
  return <output>{String(open)}</output>;
};
