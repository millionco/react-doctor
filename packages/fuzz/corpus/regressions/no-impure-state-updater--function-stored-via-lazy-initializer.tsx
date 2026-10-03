// verdict: pass
// rule: no-impure-state-updater
// weakness: lazy-initializer-transparency
// source: GitHub issue #1817
import { useState } from "react";

export function Repro() {
  const [dirty] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);

  const guard = (action: () => void) => {
    if (dirty) setPending(() => action);
    else action();
  };

  const openForEdit = () => setOpen(true);

  const start = () => {
    guard(() => openForEdit());
  };

  return (
    <button type="button" onClick={pending ? () => pending() : start}>
      {open ? "open" : "go"}
    </button>
  );
}
