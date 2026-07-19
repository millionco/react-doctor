// rule: no-side-effect-in-state-updater-function
// weakness: copy-tracking
// source: PR #1000 deep precision review

import { useState } from "react";

export const Counter = () => {
  const [, setCount] = useState(0);
  setCount((previous) => {
    const local = { track: (value: number) => value };
    local.track(previous);
    return previous + 1;
  });
  return null;
};
