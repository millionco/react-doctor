// rule: no-mutate-then-set-or-return-same-reference
// weakness: control-flow
// source: PR #1000 final adversarial audit

import { useState } from "react";

export const CorrelatedMutation = ({ enabled }: { enabled: boolean }) => {
  const [, setItems] = useState<number[]>([]);
  setItems((items) => {
    if (enabled) {
      if (!enabled) items.push(1);
    }
    if (enabled) return items;
    return [...items];
  });
  return null;
};
