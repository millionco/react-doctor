// rule: no-boolean-toggle-without-functional-update
// weakness: initializer-guard
// source: Cursor Bugbot review on PR #1383

import { useRef, useState } from "react";

export const DelayedToggle = () => {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  setTimeout(() => {
    if (openRef.current === open) setOpen(!open);
  }, 1);
  return open;
};
