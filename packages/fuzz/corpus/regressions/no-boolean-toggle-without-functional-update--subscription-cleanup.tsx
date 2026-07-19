// rule: no-boolean-toggle-without-functional-update
// weakness: cleanup-proof
// source: PR #1000 final precision review

import { useEffect, useState } from "react";

export const Toggle = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const subscription = source.subscribe(() => setOpen(!open));
    return () => subscription.unsubscribe();
  }, [open]);
  return null;
};
