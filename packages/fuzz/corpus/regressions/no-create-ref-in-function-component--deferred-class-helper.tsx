// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import { createRef, useRef } from "react";
declare const consume: (ref: { current: HTMLDivElement | null }) => unknown;
export const Panel = () => {
  const makeRef = () => {
    class Holder {
      ref = consume(createRef<HTMLDivElement>());
    }
    return null;
  };
  makeRef();
  return <div />;
};

export const RootFieldPanel = () => {
  const refs = useRef<Array<{ current: HTMLDivElement | null }>>([]);
  const makeRef = () => {
    const ref = createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  class Holder {
    ref = makeRef();
  }
  return <div />;
};
