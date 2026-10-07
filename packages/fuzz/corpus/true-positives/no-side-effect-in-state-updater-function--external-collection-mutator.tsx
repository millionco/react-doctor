// rule: no-side-effect-in-state-updater-function
// weakness: copy-tracking
// source: React Bench exact replay

import { useRef, useState } from "react";

export const ExternalCollectionMutator = () => {
  const cache = useRef(new Map<string, number>());
  const [, setValue] = useState(0);
  setValue((previous) => {
    cache.current.set("value", previous);
    return previous + 1;
  });
  return null;
};
