// rule: no-reset-all-state-on-prop-change
// weakness: wrapper-transparency
// source: independent synthetic PR review regression
// verdict: pass
// file-path: corpus/regressions/no-reset-all-state-on-prop-change--slate-focus-role/review-case.tsx
import { useEffect, useState } from "react";
import { FocusApi } from "./bridge";
export const FocusPanel = ({ entity }: { entity: object }) => {
  const [focused, setFocused] = useState(FocusApi.isFocused(entity) as boolean);
  useEffect(() => {
    setFocused(FocusApi.isFocused(entity) as boolean);
  }, [entity]);
  return <output>{String(focused)}</output>;
};
