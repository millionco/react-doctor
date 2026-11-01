// rule: effect-needs-cleanup
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import { useEffect } from "react";
interface clearInterval {}
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
        observer.disconnect();
      };
    }
  }, [target]);
  return <div />;
};
