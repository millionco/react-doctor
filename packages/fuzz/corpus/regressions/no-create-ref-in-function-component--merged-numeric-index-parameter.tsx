// rule: no-create-ref-in-function-component
// weakness: copy-tracking
// source: independent synthetic inline-map review
// verdict: fail
import { createRef } from "react";
export const Example = () => {
  const refs = [1, 2].map(() => createRef());
  const focus = (index: number) => {
    interface index {}
    void refs[index].current;
  };
  return <button onClick={() => focus(0)} />;
};
