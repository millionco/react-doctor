// rule: no-hydration-branch-on-browser-global
// weakness: combined-wrapper-transparency
// source: PR #1353 Bugbot review — combined local helper predicates

import { useMemo } from "react";

const hasWindow = () => typeof window !== "undefined";
const hasDocument = () => typeof document !== "undefined";

export const RuntimeBranch = () => {
  const canUseWindow = useMemo(hasWindow, []);
  const canUseDocument = useMemo(hasDocument, []);
  return canUseWindow && canUseDocument ? <Client /> : <Server />;
};
