import { useEffect } from "react";

export const ObserverRestartedAfterRelease = ({ target }: { target: Element }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    const start = () => observer.observe(target);
    observer.disconnect();
    start();
  }, [target]);

  return null;
};
