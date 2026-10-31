// rule: no-create-ref-in-function-component
// weakness: copy-tracking
// source: independent synthetic inline-map review
// verdict: pass
import { createRef, useEffect } from "react";
import { replaceAll } from "./helpers";
export const Example = () => {
  const refs = [1, 2].map(() => createRef());
  replaceAll(refs);
  useEffect(() => {
    void refs[0].current;
  }, [refs]);
  return <div ref={refs[0]} />;
};
