// rule: prefer-module-scope-static-value
// weakness: provider-identity
// source: independent synthetic erased namespace regression
// verdict: pass
namespace require {
  export interface Marker {}
}
require("react").useRef = () => null;
import { useRef } from "react";

export const RefSlots = () => {
  const slots = { primary: useRef<HTMLDivElement>(null) };
  return <div ref={slots.primary} />;
};
