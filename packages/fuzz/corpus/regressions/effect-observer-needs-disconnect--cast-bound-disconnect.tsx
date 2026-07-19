import { useEffect } from "react";

export const CastBoundDisconnect = ({ target }: { target: Element }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    observer.observe(target);
    return (observer.disconnect as typeof observer.disconnect).bind(observer);
  }, [target]);

  return null;
};
