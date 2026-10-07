// rule: effect-needs-cleanup
// weakness: control-flow
// source: issue #1736 observer forEach false positive
// verdict: pass

import { useEffect } from "react";

export const ObserverForEach = ({ elements }: { elements: HTMLElement[] }) => {
  useEffect(() => {
    const observer = new IntersectionObserver(() => {});
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [elements]);
  return null;
};
