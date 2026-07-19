// rule: no-boolean-toggle-without-functional-update
// weakness: wrapper-transparency
// source: PR #1000 final independent audit

import { useState } from "react";

export const ListenerOutsideEffect = () => {
  const [open, setOpen] = useState(false);
  const install = () => document.addEventListener("toggle", () => setOpen(!open));
  return <button onClick={install}>Install</button>;
};
