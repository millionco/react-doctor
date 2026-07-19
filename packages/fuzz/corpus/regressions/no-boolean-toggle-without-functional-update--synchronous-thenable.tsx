// rule: no-boolean-toggle-without-functional-update
// weakness: library-idiom
// source: PR #1000 final independent audit

import { useState } from "react";

export const SynchronousThenable = () => {
  const [open, setOpen] = useState(false);
  const run = () =>
    ({
      then(callback: () => void) {
        callback();
      },
    }).then(() => setOpen(!open));
  return (
    <button type="button" onClick={run}>
      {String(open)}
    </button>
  );
};
