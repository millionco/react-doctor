import { useEffect } from "react";

const handleMutations = () => undefined;

export const MutationTracker = () => {
  useEffect(() => {
    const observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { childList: true });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return null;
};
