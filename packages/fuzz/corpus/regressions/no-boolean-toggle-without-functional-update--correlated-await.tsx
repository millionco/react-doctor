// rule: no-boolean-toggle-without-functional-update
// weakness: control-flow
// source: PR #1000 final precision review

import { useState } from "react";

export const Toggle = ({ shouldLoad }: { shouldLoad: boolean }) => {
  const [open, setOpen] = useState(false);
  const run = async () => {
    if (shouldLoad) await load();
    if (shouldLoad) return;
    setOpen(!open);
  };
  return <button onClick={run}>{String(open)}</button>;
};
