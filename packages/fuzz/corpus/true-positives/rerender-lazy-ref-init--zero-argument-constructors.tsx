// rule: rerender-lazy-ref-init
// weakness: constructor
// source: ReactBench audit

import { useRef } from "react";

export const Cache = () => {
  const entries = useRef(new Map());
  const selected = useRef(new Set());
  const controller = useRef(new AbortController());
  return null;
};
