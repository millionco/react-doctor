// rule: no-boolean-toggle-without-functional-update
// weakness: control-flow
// source: PR #1000 final independent audit

import { useEffect, useRef, useState } from "react";

export const OverwrittenStateMirror = () => {
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  openRef.current = false;
  useEffect(() => {
    queueMicrotask(() => {
      if (openRef.current === open) setOpen(!open);
    });
  }, [open]);
  return null;
};
