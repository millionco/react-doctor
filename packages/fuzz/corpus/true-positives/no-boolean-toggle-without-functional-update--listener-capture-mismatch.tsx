// rule: no-boolean-toggle-without-functional-update
// weakness: control-flow
// source: PR #1000 final adversarial audit

import { useEffect, useState } from "react";

export const CaptureMismatch = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen(!open);
    document.addEventListener("click", toggle, { capture: true });
    return () => document.removeEventListener("click", toggle);
  }, [open]);
  return null;
};
