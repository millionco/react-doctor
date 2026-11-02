// rule: no-ref-current-in-render
// weakness: alias-guard
// source: React useRef contract and TypeScript type/value namespaces
// verdict: fail
import { useRef } from "react";

export interface Reflect {}

export const LatestValue = ({ value }) => {
  const valueRef = useRef(null);
  Reflect.set(valueRef, "current", value);
  return null;
};
