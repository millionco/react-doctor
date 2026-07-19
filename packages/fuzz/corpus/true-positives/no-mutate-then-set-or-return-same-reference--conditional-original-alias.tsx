// rule: no-mutate-then-set-or-return-same-reference
// weakness: copy-tracking
// source: PR #1000 final independent audit

import { useState } from "react";

export const ConditionalOriginalAlias = ({ shouldCopy }: { shouldCopy: boolean }) => {
  const [, setItems] = useState<number[]>([]);
  setItems((items) => {
    const maybeCopy = shouldCopy ? [] : items;
    items = maybeCopy;
    items.push(1);
    return items;
  });
  return null;
};
