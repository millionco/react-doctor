// rule: no-side-effect-in-state-updater-function
// weakness: receiver-provenance
// source: Cursor Bugbot PR #1525
// verdict: pass

import { useState } from "react";

export const LazyLocalFactoryAssignment = () => {
  const [, setValues] = useState(new Map<string, number>());
  setValues((previous) => {
    const createDraft = () => new Map(previous);
    let draft: Map<string, number> | null = null;
    draft = createDraft();
    draft.set("value", 1);
    return draft;
  });
  return null;
};
