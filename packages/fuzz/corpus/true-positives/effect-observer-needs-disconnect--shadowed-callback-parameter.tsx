import { useEffect } from "react";

export const VisibilityTracker = ({ node }: { node: Element }): null => {
  useEffect(() => {
    const observer = new IntersectionObserver((entries, _currentObserver) => {
      entries.forEach((entry) => {
        const _currentObserver = makeObserverController(entry);
        _currentObserver.disconnect();
      });
    });
    observer.observe(node);
  }, [node]);
  return null;
};

declare const makeObserverController: (entry: IntersectionObserverEntry) => IntersectionObserver;
