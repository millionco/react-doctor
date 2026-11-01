// rule: prefer-module-scope-static-value
// weakness: provider-identity
// source: independent synthetic merged imported provider exposure
// verdict: pass
const rewriteProvider = () => {
  interface useRef {}
  mutate(useRef);
};
rewriteProvider();
import { useRef } from "react";

export const RefSlots = () => {
  const slots = { primary: useRef<HTMLDivElement>(null) };
  return <div ref={slots.primary} />;
};
