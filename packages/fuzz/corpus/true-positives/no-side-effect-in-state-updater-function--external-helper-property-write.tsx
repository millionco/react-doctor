// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: PR #1000 final independent audit

import { useState } from "react";

export const ExternalHelperWrite = ({ metrics }: { metrics: { count: number } }) => {
  const [, setValue] = useState(0);
  setValue((value) => {
    const increment = (target: { count: number }) => {
      target.count += 1;
    };
    increment(metrics);
    return value + 1;
  });
  return null;
};
