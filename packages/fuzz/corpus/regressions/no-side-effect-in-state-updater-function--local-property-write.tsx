// rule: no-side-effect-in-state-updater-function
// weakness: copy-tracking
// source: PR #1000 final independent audit

import { useState } from "react";

export const LocalWrite = () => {
  const [, setValue] = useState(0);
  setValue((value) => {
    const next = { value };
    next.value += 1;
    return next.value;
  });
  return null;
};
