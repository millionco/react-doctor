// rule: no-boolean-toggle-without-functional-update
// weakness: library-idiom
// source: PR #1000 final adversarial audit

import { useEffect, useState } from "react";

export const FrameToggle = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const frameId = requestAnimationFrame(() => setOpen(!open));
    return () => cancelAnimationFrame(frameId);
  }, [open]);
  return null;
};
