import { useOptimistic } from "react";

export const RenderUpdate = () => {
  const [optimisticCount, setOptimisticCount] = useOptimistic(
    0,
    (_pendingCount, nextCount: number) => nextCount,
  );
  setOptimisticCount(1);

  return <output>{optimisticCount}</output>;
};
