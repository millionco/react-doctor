import { useEffect } from "react";

interface ObserverConsumerProperties {
  observer: IntersectionObserver | ResizeObserver;
}

export const ObserverConsumer = ({ observer }: ObserverConsumerProperties) => {
  useEffect(() => {
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [observer]);

  return null;
};
