// rule: prefer-module-scope-static-value
// weakness: provider-identity
// source: independent synthetic erased-provider regression
// verdict: pass
declare const globalThis: any;
globalThis.require("react").useRef = () => null;
import { useRef } from "react";

export const RefSlots = () => {
  const slots = { primary: useRef<HTMLDivElement>(null) };
  return <div ref={slots.primary} />;
};
