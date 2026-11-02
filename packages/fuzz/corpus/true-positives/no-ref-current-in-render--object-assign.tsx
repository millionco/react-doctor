// rule: no-ref-current-in-render
// weakness: library-idiom
// source: PR #2310 review
// verdict: fail
import { useRef } from "react";

export const LatestValue = ({ value }) => {
  const valueRef = useRef(null);
  Object.assign(valueRef, { current: value });
  return null;
};
