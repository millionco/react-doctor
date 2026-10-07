// rule: no-side-effect-in-state-updater-function
// weakness: receiver-provenance
// source: Cursor Bugbot PR #1525
// verdict: fail

import { useState } from "react";

const externalCache = new Map<string, number>();

export const MisleadingPropertyFactory = () => {
  const [, setValue] = useState({ cache: externalCache });
  setValue((previous) => {
    const createLocalCache = () => externalCache;
    const next = { ...previous };
    next.cache = createLocalCache();
    next.cache.set("value", 1);
    return next;
  });
  return null;
};
