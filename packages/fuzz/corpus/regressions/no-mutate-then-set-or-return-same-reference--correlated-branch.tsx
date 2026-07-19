// rule: no-mutate-then-set-or-return-same-reference
// weakness: control-flow
// source: PR #1000 final precision review

import { useState } from "react";

export const Rows = ({ shouldCopy }: { shouldCopy: boolean }) => {
  const [, setRows] = useState<number[]>([]);
  setRows((previous) => {
    if (shouldCopy) previous.push(1);
    return shouldCopy ? [...previous] : previous;
  });
  return null;
};
