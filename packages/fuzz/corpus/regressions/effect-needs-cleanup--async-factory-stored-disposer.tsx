// rule: effect-needs-cleanup
// weakness: wrapper-transparency
// source: actual async factory runtime boundary probe
// verdict: fail

import { useEffect } from "react";

interface Props {
  element: HTMLElement;
}

export const AsyncFactoryStoredDisposer = ({ element }: Props) => {
  useEffect(() => {
    let cleanupObserver = () => {};
    const observe = async () => {
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
