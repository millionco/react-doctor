// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: callback-boundary
// source: independent synthetic regression
import { createRef } from "react";
const callbacks: Array<() => unknown> = [];
const deferred = {
  map(callback: () => unknown) {
    callbacks.push(callback);
    return [];
  },
};
export const DeferredCustomMap = () => {
  const refs = deferred.map(() => createRef());
  return <div data-count={refs.length} />;
};
