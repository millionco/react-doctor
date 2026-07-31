// rule: no-side-effect-in-state-updater-function
// weakness: receiver-provenance
// source: Cursor Bugbot PR #1525
// verdict: pass

import { useState } from "react";

export const FreshPropertyFactory = () => {
  const [, setValue] = useState({ cache: new Map<string, number>() });
  setValue((previous) => {
    const createDraft = () => new Map(previous.cache);
    const next = { ...previous };
    next.cache = createDraft();
    next.cache.set("value", 1);
    return next;
  });
  return null;
};
