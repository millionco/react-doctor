// rule: no-create-ref-in-function-component
// weakness: copy-tracking
// source: independent synthetic inline-map review
// verdict: fail
import rows from "./rows";
import { createRef, useEffect } from "react";
export const Example = () => {
  interface rows {}
  const refs = rows.map(() => createRef());
  useEffect(() => {
    void refs[0].current;
  }, [refs]);
  return <div ref={refs[0]} />;
};
