// rule: no-mutate-then-set-or-return-same-reference
// weakness: control-flow
// source: PR #1000 deep precision review

import { useState } from "react";

export const Queue = () => {
  const [, setRows] = useState<string[]>([]);
  setRows((previous) => {
    previous.push("next");
    return previous;
  });
  return null;
};
