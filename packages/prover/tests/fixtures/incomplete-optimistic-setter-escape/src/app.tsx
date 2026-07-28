import { useOptimistic } from "react";

export const EscapedOptimisticSetter = () => {
  const [optimisticCount, setOptimisticCount] = useOptimistic(0);
  const escapedSetter = setOptimisticCount;

  return <output data-setter={escapedSetter}>{optimisticCount}</output>;
};
