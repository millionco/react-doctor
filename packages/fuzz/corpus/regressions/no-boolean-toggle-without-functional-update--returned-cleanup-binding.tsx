// rule: no-boolean-toggle-without-functional-update
// weakness: alias-guard
// source: Cursor Bugbot review on PR #1383

import { useEffect, useState } from "react";

export const NamedCleanupToggle = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const intervalId = setInterval(() => setOpen(!open), 100);
    const cleanup = () => clearInterval(intervalId);
    return cleanup;
  }, [open]);
  return null;
};
