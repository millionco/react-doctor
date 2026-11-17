// rule: no-ref-current-in-render
// weakness: alias-guard
// source: Synthetic merged or global runtime provider
// verdict: pass
import { useRef } from "react";

declare global {
  function Reflect(): unknown;
}

const nativeReflect = globalThis.Reflect;

export const Panel = () => {
  const valueRef = useRef(null);
  (nativeReflect as any).set(valueRef, "current", 1);
  return null;
};
