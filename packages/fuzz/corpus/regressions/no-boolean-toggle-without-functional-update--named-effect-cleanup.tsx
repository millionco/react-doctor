// rule: no-boolean-toggle-without-functional-update
// weakness: wrapper-transparency
// source: PR #1000 final adversarial audit

import { useEffect, useState } from "react";

export const NamedEffectToggle = () => {
  const [open, setOpen] = useState(false);
  const install = () => {
    const intervalId = setInterval(() => setOpen(!open), 100);
    return () => clearInterval(intervalId);
  };
  useEffect(install, [open]);
  return null;
};
