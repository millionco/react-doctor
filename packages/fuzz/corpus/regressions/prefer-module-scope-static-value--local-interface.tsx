// rule: prefer-module-scope-static-value
// weakness: provider-identity
// source: independent synthetic runtime binding regression
// verdict: pass
const require = (_source: string) => ({ useRef: () => null });
interface require {}
require("react").useRef = () => null;
import { useRef } from "react";

export const RefSlots = () => {
  const slots = { primary: useRef<HTMLDivElement>(null) };
  return <div ref={slots.primary} />;
};
