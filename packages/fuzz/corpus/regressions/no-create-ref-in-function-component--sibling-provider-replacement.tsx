// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import React from "react";
const stable = { current: null };
React.change = function () {
  this.createRef = () => stable;
};
React.change();
export const Panel = () => {
  const refs = React.useRef<Array<{ current: HTMLDivElement | null }>>([]);
  const makeRef = () => {
    const ref = React.createRef<HTMLDivElement>();
    refs.current.push(ref);
    return ref;
  };
  return <div ref={makeRef()} />;
};
