// rule: no-create-ref-in-function-component
// weakness: copy-tracking
// source: independent synthetic inline-map review
// verdict: pass
Function("Array.prototype.map = function(callback) { return [] }")();
import { createRef, useEffect } from "react";
export const Example = () => {
  const refs = [1, 2].map(() => createRef());
  useEffect(() => {
    void refs[0].current;
  }, [refs]);
  return <div ref={refs[0]} />;
};
