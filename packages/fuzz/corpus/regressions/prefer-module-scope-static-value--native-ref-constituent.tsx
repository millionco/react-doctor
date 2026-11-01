// rule: prefer-module-scope-static-value
// verdict: pass
// weakness: library-idiom
// source: independently synthetic native Hook initializer
import { useRef } from "react";

export const RefSlots = () => {
  const slots = { primary: useRef<HTMLDivElement>(null) };
  return <div ref={slots.primary} />;
};
