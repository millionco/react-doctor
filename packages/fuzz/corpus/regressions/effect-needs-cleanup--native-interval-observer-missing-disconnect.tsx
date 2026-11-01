// rule: effect-needs-cleanup
// weakness: resource-ownership
// source: synthetic
// verdict: fail
import { useEffect } from "react";
export const ObserverPanel = ({ target }: { target: Element }) => {
  useEffect(() => {
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {});
      const interval = setInterval(() => {
        if (target) {
          clearInterval(interval);
          observer.observe(target);
        }
      }, 10);
      return () => {
        clearInterval(interval);
      };
    }
  }, [target]);
  return <div />;
};
