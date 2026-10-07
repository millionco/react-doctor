// rule: rerender-lazy-ref-init
// verdict: pass
// weakness: library-idiom
// source: ReactBench RD093-FP-001

import { useRef } from "react";

export const Registry = () => {
  const entriesById = useRef(new Map<string, string>());
  const visitedIds = useRef(new Set<string>());

  return <output>{entriesById.current.size + visitedIds.current.size}</output>;
};
