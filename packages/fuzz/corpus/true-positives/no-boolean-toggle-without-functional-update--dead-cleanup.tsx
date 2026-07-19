// rule: no-boolean-toggle-without-functional-update
// weakness: control-flow
// source: PR #1000 final adversarial audit

import { useEffect, useState } from "react";

export const DeadCleanup = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen(!open);
    const shouldCleanup = false;
    document.addEventListener("click", toggle);
    return () => {
      if (shouldCleanup) document.removeEventListener("click", toggle);
    };
  }, [open]);
  return null;
};
