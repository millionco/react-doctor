// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import { createRef, useRef, useState } from "react";

interface ItemRef {
  current: HTMLDivElement | null;
}

export const ItemPanel = () => {
  const refs = useRef<ItemRef[]>([]);
  const makeItemRef = () => {
    const ref = createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  const [ref] = useState(makeItemRef());
  return <div ref={ref}>Item</div>;
};
