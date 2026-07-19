import { useEffect } from "react";

export const CastObserverHelperCall = ({ target }: { target: Element }) => {
  useEffect(() => {
    const start = () => {
      const observer = new ResizeObserver(() => {});
      observer.observe(target);
    };
    (start as typeof start)();
  }, [target]);

  return null;
};
