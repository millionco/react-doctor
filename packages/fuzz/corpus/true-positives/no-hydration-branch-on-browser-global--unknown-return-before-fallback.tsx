// rule: no-hydration-branch-on-browser-global
// weakness: control-flow
// source: Fresh handwritten uncertain helper-return regression
// verdict: fail

import React from "react";

const readMode = () => {
  if (typeof window === "undefined") return undefined;
  if (Date.now() > 0) return "compact";
  return undefined;
};

export const Preview = () => {
  const mode = readMode();
  return <div>{mode === "compact" ? "Compact" : "Expanded"}</div>;
};
