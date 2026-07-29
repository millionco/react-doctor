// rule: no-hydration-branch-on-browser-global
// weakness: boolean-comparison
// source: adversarial review

import React from "react";

export const Page = () => {
  const stable = (typeof window === "undefined") === (typeof window === "undefined");
  return stable ? <Same /> : <Different />;
};
