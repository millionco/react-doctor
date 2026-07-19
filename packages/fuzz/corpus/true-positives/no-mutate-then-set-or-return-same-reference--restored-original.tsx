// rule: no-mutate-then-set-or-return-same-reference
// weakness: copy-tracking
// source: PR #1000 final adversarial audit

import { useState } from "react";

export const RestoredOriginal = () => {
  const [, setItems] = useState<number[]>([]);
  setItems((items) => {
    const original = items;
    items = [...items];
    items = original;
    items.push(1);
    return items;
  });
  return null;
};
