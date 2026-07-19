// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: PR #1000 final independent audit

import { useState } from "react";

export const LocalHelperWrite = () => {
  const [, setValue] = useState({ count: 0 });
  setValue((value) => {
    const increment = (target: { count: number }) => {
      target.count += 1;
    };
    increment(value);
    return value;
  });
  return null;
};
