// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: PR #1000 deep precision review

import { useState } from "react";

export const Counter = ({ onChange: change }: { onChange: (value: number) => void }) => {
  const [, setCount] = useState(0);
  setCount((previous) => {
    change(previous);
    return previous + 1;
  });
  return null;
};
