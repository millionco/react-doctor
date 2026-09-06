// rule: no-hydration-branch-on-browser-global
// weakness: control-flow
// source: Fresh handwritten preserved-initial-value regression
// verdict: pass

import React from "react";

const readMode = () => {
  let mode = "wide";
  if (typeof window !== "undefined") {
    mode = "wide";
    return mode;
  }
  return mode;
};

export const Preview = () => (readMode() === "compact" ? <div /> : <span />);
