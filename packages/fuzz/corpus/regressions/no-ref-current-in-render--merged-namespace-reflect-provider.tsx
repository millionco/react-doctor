// rule: no-ref-current-in-render
// weakness: alias-guard
// source: Synthetic merged or global runtime provider
// verdict: pass
import { useRef } from "react";

export namespace Container {
  export const Reflect = { set: () => false };
}

export namespace Container {
  export const Panel = () => {
    const valueRef = useRef(null);
    Reflect.set(valueRef, "current", 1);
    return null;
  };
}
