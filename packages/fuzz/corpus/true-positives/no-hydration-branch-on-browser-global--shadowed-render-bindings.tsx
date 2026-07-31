// rule: no-hydration-branch-on-browser-global
// weakness: binding-identity
// source: adversarial review

import React from "react";

export const Page = () => {
  if (typeof window !== "undefined") {
    const label = "client";
    return <div title={label}>{label}</div>;
  }
  const label = "server";
  return <div title={label}>{label}</div>;
};
