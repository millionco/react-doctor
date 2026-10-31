// rule: no-create-ref-in-function-component
// weakness: copy-tracking
// source: independent synthetic inline-map review
// verdict: pass
import { createRef, useEffect } from "react";
import { stableRef } from "./helpers";
export const Example = () => {
  const refs = [1, 2].map(() => createRef());
  const alias = refs;
  alias.fill(stableRef);
  useEffect(() => {
    void refs[0].current;
  }, [refs]);
  return <div ref={refs[0]} />;
};
