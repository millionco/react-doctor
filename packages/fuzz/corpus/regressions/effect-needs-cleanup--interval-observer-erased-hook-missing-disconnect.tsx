// rule: effect-needs-cleanup
// weakness: name-heuristic
// source: synthetic
// verdict: fail
import { useEffect } from "react";
interface useEffect {}
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
