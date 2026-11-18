// rule: effect-observer-needs-disconnect
// verdict: pass
// weakness: binding-projection
// source: synthetic
import { useEffect } from "react";

export const useCapturedObserver = (): void => {
  useEffect(() => {
    const observer = new IntersectionObserver(() => {});
    const rows = [{ node: document.getElementById("heading") }];
    rows.forEach(({ node }) => {
      if (node) observer.observe(node);
    });
    return () => {
      rows.forEach(({ node: target }) => {
        if (target) observer.unobserve(target);
      });
    };
  }, []);
};
