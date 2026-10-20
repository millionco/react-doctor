// rule: no-boolean-toggle-without-functional-update
// weakness: wrapper-transparency
// source: synthetic source-boundary regression
import { useEffect, useState } from "react";
export const Example = ({ mode, target }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // oxlint-disable-next-line no-eval -- regression seed for transparent direct eval
    (eval as any)("mode = true");
    let listener;
    if (mode) {
      listener = () => {};
    } else {
      listener = () => setOpen(!open);
    }
    target.addEventListener("change", listener);
    return () => target.removeEventListener("change", listener);
  });
  return <output>{String(open)}</output>;
};
