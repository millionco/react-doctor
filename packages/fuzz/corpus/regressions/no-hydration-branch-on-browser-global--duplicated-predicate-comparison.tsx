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

export const AliasComparisons = () => {
  const isServer = typeof window === "undefined";
  const serverAlias = isServer;
  const zero = 0;
  const stable = serverAlias === isServer;
  const primitive = isServer === zero;
  return stable || primitive ? <Same /> : <Different />;
};

export const MutableAliasComparisons = () => {
  let isServer = false;
  if (typeof window === "undefined") isServer = true;
  const equal = isServer === isServer;
  const unequal = isServer !== isServer;
  return equal || unequal ? <Same /> : <Different />;
};
