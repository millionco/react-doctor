// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: control-flow
// source: PR #1525 Bugbot review

import { useState } from "react";

export const DeadTernaryArm = ({ onChange }: { onChange: (value: number) => void }) => {
  const [, setValue] = useState(0);
  setValue((previous) => {
    false ? onChange(previous) : undefined;
    true ? undefined : onChange(previous);
    return previous + 1;
  });
  return null;
};
