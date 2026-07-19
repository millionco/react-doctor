// rule: no-boolean-toggle-without-functional-update
// weakness: control-flow
// source: PR #1000 final adversarial audit

import { useEffect, useRef, useState } from "react";

export const RefGuardedToggle = () => {
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  useEffect(() => {
    queueMicrotask(() => {
      if (openRef.current === open) setOpen(!open);
    });
  }, [open]);
  openRef.current = open;
  return null;
};
