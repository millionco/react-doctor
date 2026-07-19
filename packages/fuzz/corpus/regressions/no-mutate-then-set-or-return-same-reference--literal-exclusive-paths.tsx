// rule: no-mutate-then-set-or-return-same-reference
// weakness: control-flow
// source: PR #1000 final independent audit

import { useState } from "react";

export const ExclusivePaths = ({ mode }: { mode: "copy" | "mutate" | "return" }) => {
  const [, setItems] = useState<number[]>([]);
  setItems((items) => {
    if (mode === "mutate") items.push(1);
    if (mode === "return") return items;
    return [...items];
  });
  return null;
};
