// rule: no-boolean-toggle-without-functional-update
// weakness: control-flow
// source: PR #1000 final independent audit

import { useEffect, useState } from "react";

export const AsyncListenerInstall = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen(!open);
    Promise.resolve().then(() => document.addEventListener("toggle", toggle));
    return () => document.removeEventListener("toggle", toggle);
  }, [open]);
  return null;
};
