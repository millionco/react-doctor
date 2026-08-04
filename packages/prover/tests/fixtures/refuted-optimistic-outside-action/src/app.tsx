import { useOptimistic } from "react";

export const OptimisticButton = () => {
  const [optimisticCount, setOptimisticCount] = useOptimistic(
    0,
    (pendingCount, nextCount: number) => pendingCount + nextCount,
  );

  return (
    <button type="button" onClick={() => setOptimisticCount(1)}>
      {optimisticCount}
    </button>
  );
};
