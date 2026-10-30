// rule: effect-needs-cleanup
// weakness: wrapper-transparency
// source: strict fuzz seed 42000546 stored observer disposer
// verdict: pass

import { useEffect } from "react";

interface Props {
  element: HTMLElement;
}

export const StoredObserverDisposer = ({ element }: Props) => {
  useEffect(() => {
    let cleanupObserver = () => {};
    const observe = () => {
      const observer = new IntersectionObserver(() => {});
      observer.observe(element);
      return () => observer.disconnect();
    };
    cleanupObserver = observe();
    const cleanup = () => cleanupObserver();
    return () => cleanup();
  }, [element]);
  return null;
};
