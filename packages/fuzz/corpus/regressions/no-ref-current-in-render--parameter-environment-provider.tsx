// rule: no-ref-current-in-render
// weakness: alias-guard
// source: synthetic parameter environment regression
// verdict: pass
import { useRef } from "react";

export function Outer() {
  const shared = useRef(0);
  const Object = { assign: (..._values: unknown[]) => ({}) };
  function Panel({ value = Object.assign(shared, { current: 1 }) } = {}) {
    const Object = globalThis.Object;
    return null;
  }
  return <Panel />;
}
