// rule: no-side-effect-in-state-updater-function
// weakness: control-flow
// source: PR #1000 final independent audit

import { useState } from "react";

export const ExternalWrite = ({ metrics }: { metrics: { count: number } }) => {
  const [, setValue] = useState(0);
  setValue((value) => {
    metrics.count += 1;
    return value + 1;
  });
  return null;
};
