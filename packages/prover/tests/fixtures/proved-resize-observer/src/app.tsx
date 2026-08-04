import { useEffect } from "react";

const handleResize = () => undefined;

export const ResizeTracker = () => {
  useEffect(() => {
    const observer = new ResizeObserver(handleResize);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  return null;
};
