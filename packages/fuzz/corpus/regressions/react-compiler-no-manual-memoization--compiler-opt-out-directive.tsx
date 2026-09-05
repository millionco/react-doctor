// verdict: pass
// rule: react-compiler-no-manual-memoization
// weakness: framework-gating
// source: GitHub issue #1749

import { useMemo } from "react";

export const LegacyComponent = () => {
  "use no memo";
  const cachedValue = useMemo(() => getValue(), []);
  return <span>{cachedValue}</span>;
};
