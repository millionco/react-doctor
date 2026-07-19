// rule: no-boolean-toggle-without-functional-update
// weakness: alias-guard
// source: PR #1000 final independent audit

import { useState } from "react";

export const GlobalTimerToggle = () => {
  const [open, setOpen] = useState(false);
  const run = () => globalThis.setTimeout(() => setOpen(!open), 0);
  return (
    <button type="button" onClick={run}>
      {String(open)}
    </button>
  );
};
