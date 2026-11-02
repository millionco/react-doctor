// rule: no-ref-current-in-render
// weakness: alias-guard
// source: ECMAScript Reflect.set receiver semantics
// verdict: fail
import { useRef } from "react";

export const LatestValue = ({ value }) => {
  const targetRef = useRef(null);
  const receiverRef = useRef(null);
  Reflect.set(targetRef, "current", value, receiverRef);
  return null;
};
