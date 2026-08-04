import { useEffect } from "react";

const handleMutations = () => undefined;

export const MutationTracker = () => {
  useEffect(() => {
    const observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { subtree: true });
  }, []);

  return null;
};
