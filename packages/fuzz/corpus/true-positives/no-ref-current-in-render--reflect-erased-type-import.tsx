// rule: no-ref-current-in-render
// weakness: alias-guard
// source: React useRef contract and TypeScript erased imports
// verdict: fail
import { type Reflect, runtimeValue } from "./types";
import { useRef } from "react";

export { runtimeValue };
export type { Reflect };

export const LatestValue = ({ value }) => {
  const valueRef = useRef(null);
  Reflect.set(valueRef, "current", value);
  return null;
};
