import { useEffect } from "react";

export const Preview = ({ first, second }: { first: Element; second: Element }) => {
  useEffect(() => {
    const observer = new ResizeObserver((_entries, currentObserver) => {
      currentObserver.unobserve(first);
    });
    observer.observe(first);
    observer.observe(second);
  }, [first, second]);

  return null;
};
