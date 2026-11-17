// rule: no-ref-current-in-render
// weakness: alias-guard
// source: ECMAScript Reflect.set receiver semantics
// verdict: pass
import { useRef } from "react";

export const Snapshot = ({ value }) => {
  const valueRef = useRef(null);
  const snapshot = {};
  Reflect.set(valueRef, "current", value, snapshot);
  return null;
};
