// Rule: exhaustive-deps. Weakness: copy-tracking. Source: synthetic audit regression.
import { useEffect, useMemo } from "react";

const makeOperations = () => {
  let sequence = 0;
  const clear = () => {
    sequence = 0;
  };
  return [
    () => {
      sequence += 1;
    },
    clear,
  ];
};

export const OperationPanel = () => {
  const [start, clear] = useMemo(makeOperations, []);
  useEffect(() => {
    start();
    return () => clear();
  }, []);
  return null;
};
