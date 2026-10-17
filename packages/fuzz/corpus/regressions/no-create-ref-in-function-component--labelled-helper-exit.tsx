// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic

import { createRef, useRef } from "react";
export const Panel = () => {
  const refs = useRef<Array<{ current: HTMLDivElement | null }>>([]);
  const makeRef = () => {
    done: {
      break done;
      const ref = createRef<HTMLDivElement>();
      refs.current.push(ref);
    }
    return null;
  };
  makeRef();
  return <div />;
};
