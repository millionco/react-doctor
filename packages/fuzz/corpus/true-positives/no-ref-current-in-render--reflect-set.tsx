// rule: no-ref-current-in-render
// weakness: library-idiom
// source: React useRef contract and ECMAScript Reflect.set semantics
// verdict: fail
import { useRef } from "react";

export const LatestValue = ({ value }) => {
  const valueRef = useRef(null);
  Reflect.set(valueRef, "current", value);
  return null;
};
