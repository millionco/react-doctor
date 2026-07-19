// rule: no-boolean-toggle-without-functional-update
// weakness: crash
// source: PR #1000 final precision review

import { useEffect, useState } from "react";

export const Toggle = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen(!open);
    document.addEventListener("click", toggle);
    return () => document.removeEventListener("click", toggle);
  }, [open]);
  return null;
};
