// rule: no-ref-current-in-render
// weakness: alias-guard
// source: Synthetic native control beside a merged or global provider
// verdict: fail
import { useRef } from "react";

declare global {
  function Reflect(): unknown;
}

export const Panel = () => {
  const valueRef = useRef(null);
  Object.assign(valueRef, { current: 1 });
  return null;
};
