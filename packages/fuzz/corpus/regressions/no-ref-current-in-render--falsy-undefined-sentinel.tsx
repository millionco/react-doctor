// rule: no-ref-current-in-render
// weakness: control-flow
// source: react-bench Semiotic AccessibleNavTree trial

import { useRef } from "react";

export const NavigationTree = () => {
  const itemRefs = useRef<Map<string, HTMLElement> | undefined>(undefined);
  if (!itemRefs.current) itemRefs.current = new Map();
  return <output>{itemRefs.current.size}</output>;
};
