// rule: no-ref-current-in-render
// weakness: alias-guard
// source: Synthetic namespace with an unknown ambient provider
// verdict: pass
import { useRef } from "react";

export namespace Container {
  export declare function Reflect(): unknown;
  export interface Reflect {}

  export const Panel = () => {
    const valueRef = useRef(null);
    (Reflect as any).set(valueRef, "current", 1);
    return null;
  };
}
