// rule: no-hydration-branch-on-browser-global
// weakness: control-flow
// source: synthetic native parity regression
// verdict: fail

"use client";

export const Preview = () => {
  if (typeof window === "undefined") return <div />;
  return <section />;
};
