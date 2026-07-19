// rule: effect-observer-needs-disconnect
// weakness: identity-provenance
// source: PR #1000 deep adversarial audit
import { useEffect } from "react";

export const Observer = ({ element, other }: { element: Element; other: Element }) => {
  useEffect(() => {
    const observer = new ResizeObserver(handleResize);
    observer.observe(element);
    return () => observer.unobserve(other);
  }, [element, other]);
  return null;
};
