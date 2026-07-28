import { useEffect } from "react";

const handleIntersection = () => undefined;

export const IntersectionTracker = () => {
  useEffect(() => {
    const observer = new IntersectionObserver(handleIntersection);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  return null;
};
