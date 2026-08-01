// rule: no-side-effect-in-state-updater-function
// weakness: receiver-provenance
// source: Cursor Bugbot PR #1525
// verdict: fail

import { useState } from "react";

let cache: Map<string, number> | undefined;

export const ExternalChainedAssignment = () => {
  const [, setValue] = useState(0);
  setValue((previous) => {
    (cache ??= new Map()).set("value", previous);
    return previous + 1;
  });
  return null;
};
