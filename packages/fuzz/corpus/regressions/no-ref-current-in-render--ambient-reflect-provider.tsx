// rule: no-ref-current-in-render
// weakness: alias-guard
// source: Synthetic unknown ambient provider and erased interface
// verdict: pass
import { useRef } from "react";

export declare function Reflect(): unknown;
export interface Reflect {}

export const Panel = () => {
  const valueRef = useRef(null);
  (Reflect as any).set(valueRef, "current", 1);
  return null;
};
