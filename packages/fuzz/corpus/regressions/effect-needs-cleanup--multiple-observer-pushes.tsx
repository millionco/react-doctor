// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: PR #1346 Bugbot review — multiple resources retained by one collection
import { useEffect } from "react";

export const ObserverGroup = ({ elements }: { elements: Element[] }) => {
  useEffect(() => {
    const observers: ResizeObserver[] = [];
    for (const element of elements) {
      const observer = new ResizeObserver(() => updateSize());
      observer.observe(element);
      observers.push(observer);
    }
    return () => observers.forEach((observer) => observer.disconnect());
  }, [elements]);
  return null;
};
