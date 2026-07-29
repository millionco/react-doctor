// rule: no-hydration-branch-on-browser-global
// weakness: boolean-comparison
// source: adversarial review

import React from "react";

export const Page = () => {
  const stable = (typeof window === "undefined") === (typeof window === "undefined");
  return stable ? <Same /> : <Different />;
};

export const PrimitiveComparisons = () => {
  const zero = (typeof window === "undefined") === 0;
  const empty = (typeof window === "undefined") === "";
  const nullable = (typeof window === "undefined") === null;
  const missing = (typeof window === "undefined") === undefined;
  return zero || empty || nullable || missing ? <Same /> : <Different />;
};

export const BitwiseComparisons = () => {
  const masked = (typeof window === "undefined") & 0;
  const combined = (typeof window === "undefined") | (typeof window !== "undefined");
  return masked || combined ? <Same /> : <Different />;
};
