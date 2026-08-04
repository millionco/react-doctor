import { useEffect } from "react";

const handleMutations = () => undefined;

export const DormantObserver = () => {
  useEffect(() => {
    new MutationObserver(handleMutations);
  }, []);

  return null;
};
