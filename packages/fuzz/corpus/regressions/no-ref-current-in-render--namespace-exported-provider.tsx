// rule: no-ref-current-in-render
// weakness: alias-guard
// source: Synthetic mutable TypeScript namespace export
// verdict: pass
import { useRef } from "react";

export namespace Handlers {
  export const { Reflect } = globalThis;

  export const Example = () => {
    const cacheRef = useRef(0);
    Reflect.set(cacheRef, "current", 3);
    return null;
  };
}

Object.assign(Handlers, { Reflect: { set: () => false } });
