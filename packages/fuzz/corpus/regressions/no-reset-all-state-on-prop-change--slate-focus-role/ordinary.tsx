// rule: no-reset-all-state-on-prop-change
// verdict: pass
// weakness: cross-file
// source: synthetic ordinary SDK-role regression
// file-path: corpus/regressions/no-reset-all-state-on-prop-change--slate-focus-role/ordinary.tsx
import { useEffect, useState } from "react";
import { FocusApi } from "./bridge";
export const FocusPanel = ({ entity }: { entity: object }) => {
  const [focused, setFocused] = useState(FocusApi.isFocused(entity));
  useEffect(() => {
    setFocused(FocusApi.isFocused(entity));
  }, [entity]);
  return <output>{String(focused)}</output>;
};
