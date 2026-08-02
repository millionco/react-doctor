// rule: rerender-lazy-ref-init
// weakness: constructor
// source: ReactBench audit

import { useRef } from "react";

export const Cache = () => {
  const controller = useRef(new AbortController());
  return null;
};
