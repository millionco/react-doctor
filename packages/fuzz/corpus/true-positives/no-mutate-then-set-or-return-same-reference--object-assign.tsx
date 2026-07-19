// rule: no-mutate-then-set-or-return-same-reference
// weakness: copy-tracking
// source: PR #1000 final independent audit

import { useState } from "react";

export const AssignedState = () => {
  const [, setValue] = useState({ count: 0 });
  setValue((value) => {
    Object.assign(value, { count: value.count + 1 });
    return value;
  });
  return null;
};
