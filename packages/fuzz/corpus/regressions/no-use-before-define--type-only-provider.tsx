// rule: no-use-before-define
// weakness: type-only-provider
// source: synthetic
// verdict: pass
import type { useMemo } from "react";

export const Panel = () => {
  const selected = useMemo(() => later, [later]);
  const later = 1;
  return selected;
};
