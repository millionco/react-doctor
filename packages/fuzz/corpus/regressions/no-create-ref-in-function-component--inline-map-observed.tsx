// rule: no-create-ref-in-function-component
// verdict: fail
// weakness: callback-boundary
// source: independent synthetic regression
import { createRef, useEffect } from "react";
export const InlineMapObserved = () => {
  const refs = [1, 2].map(() => createRef<HTMLDivElement>());
  useEffect(() => {
    void refs[0].current;
  }, [refs]);
  return <div />;
};
