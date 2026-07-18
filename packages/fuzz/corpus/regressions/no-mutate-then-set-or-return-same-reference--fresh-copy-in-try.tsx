// rule: no-mutate-then-set-or-return-same-reference
// weakness: control-flow
// source: PR #1000 final independent audit

import { useState } from "react";

export const TryCopy = () => {
  const [, setItems] = useState<number[]>([]);
  setItems((items) => {
    try {
      items = [...items];
      items.push(1);
      return items;
    } catch {
      return [];
    }
  });
  return null;
};
