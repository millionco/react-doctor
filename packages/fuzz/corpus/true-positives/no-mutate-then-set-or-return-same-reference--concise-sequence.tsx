// rule: no-mutate-then-set-or-return-same-reference
// weakness: wrapper-transparency
// source: PR #1000 final independent audit

import { useState } from "react";

export const ConciseSequence = () => {
  const [, setItems] = useState<number[]>([]);
  setItems((items) => (items.push(1), items));
  return null;
};
