// rule: no-hydration-branch-on-browser-global
// weakness: control-flow
// source: Fresh handwritten equivalent helper-return regression
// verdict: pass

import React from "react";

const readMode = () => {
  if (typeof window === "undefined") return undefined;
  if (Date.now() > 0) return undefined;
  else return undefined;
};

export const Preview = () => {
  const mode = readMode();
  return <div>{mode === "compact" ? "Compact" : "Expanded"}</div>;
};
