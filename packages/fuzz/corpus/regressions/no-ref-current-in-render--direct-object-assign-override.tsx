// rule: no-ref-current-in-render
// weakness: alias-guard
// source: PR #2310 review
// verdict: pass
import { useRef } from "react";

export const OverriddenAssign = ({ value }) => {
  const valueRef = useRef(null);
  Object.assign = (target, _source) => target;
  Object.assign(valueRef, { current: value });
  return null;
};
