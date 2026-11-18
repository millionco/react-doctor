// rule: no-boolean-toggle-without-functional-update
// weakness: alias-resolution
// source: synthetic audit regression
import { useLayoutEffect, useState } from "react";

export const Panel = () => {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const timer = window.setInterval(() => setOpen(!open), 100);
    return () => globalThis.clearTimeout(timer);
  }, [open]);
  return null;
};
