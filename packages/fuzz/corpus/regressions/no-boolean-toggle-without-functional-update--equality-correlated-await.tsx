// rule: no-boolean-toggle-without-functional-update
// weakness: control-flow
// source: PR #1000 final adversarial audit

import { useState } from "react";

export const EqualityCorrelatedToggle = ({ shouldLoad }: { shouldLoad: boolean }) => {
  const [open, setOpen] = useState(false);
  const run = async () => {
    if (shouldLoad === true) await load();
    if (shouldLoad === false) setOpen(!open);
  };
  return <button onClick={run}>{String(open)}</button>;
};
