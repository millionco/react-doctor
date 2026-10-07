// rule: no-side-effect-in-state-updater-function
// weakness: copy-tracking
// source: React Bench exact replay

import { useState } from "react";

export const FreshCollectionMutators = () => {
  const [, setValues] = useState(new Map<string, number>());
  setValues((previous) => {
    let next: Map<string, number> | null = null;
    if (previous.size > 0) {
      if (!next) next = new Map(previous);
      next.set("value", 1);
    }
    new Set(previous.keys()).add("other");
    return next ?? previous;
  });
  return null;
};
