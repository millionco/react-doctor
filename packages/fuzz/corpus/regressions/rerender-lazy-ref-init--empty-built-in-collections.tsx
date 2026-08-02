// rule: rerender-lazy-ref-init
// verdict: pass
// weakness: library-idiom
// source: React Bench RD 0.9.3 second-pass FP-001

import { useRef } from "react";

export const EmptyCollectionRefs = () => {
  const map = useRef(new Map());
  const set = useRef(new Set());
  const weakMap = useRef(new WeakMap());
  const weakSet = useRef(new WeakSet());
  return null;
};
