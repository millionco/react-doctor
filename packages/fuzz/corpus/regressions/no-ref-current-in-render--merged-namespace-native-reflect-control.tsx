// rule: no-ref-current-in-render
// weakness: alias-guard
// source: Synthetic native control beside a merged or global provider
// verdict: fail
import { useRef } from "react";

namespace Container {
  export const Reflect = { set: () => false };
}

export const Panel = () => {
  const valueRef = useRef(null);
  Reflect.set(valueRef, "current", 1);
  return null;
};
