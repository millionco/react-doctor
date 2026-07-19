import { useEffect } from "react";

export const ReleasedIteratorObservers = ({ targets }: { targets: Element[] }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    targets.forEach((target) => observer.observe(target));
    observer.disconnect();
  }, [targets]);

  return null;
};
