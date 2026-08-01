// rule: no-side-effect-in-state-updater-function
// weakness: control-flow
// source: Cursor Bugbot PR #1525

import { useState } from "react";

export const UndefinedLazyContainer = () => {
  const [, setValues] = useState(new Map<string, number>());
  setValues((previous) => {
    let next: Map<string, number> | undefined = undefined;
    next = new Map(previous);
    next.set("value", 1);
    return next;
  });
  return null;
};
