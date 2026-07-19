// rule: no-side-effect-in-state-updater-function
// weakness: control-flow
// source: Cursor Bugbot review on PR #1383

import { useState } from "react";

export const ScheduledUpdater = () => {
  const [, setValue] = useState(0);
  const schedule = () => setTimeout(() => {}, 0);
  setValue((value) => {
    schedule();
    return value + 1;
  });
  return null;
};
