// rule: no-mutate-then-set-or-return-same-reference
// weakness: copy-tracking
// source: PR #1000 final independent audit

import { useState } from "react";

export const FreshReturn = () => {
  const [, setItems] = useState<number[]>([]);
  setItems((items) => {
    items.push(1);
    items = [...items];
    return items;
  });
  return null;
};
