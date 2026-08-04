import { startTransition, useOptimistic } from "react";

export const OptimisticCounter = () => {
  const [optimisticCount, updateOptimisticCount] = useOptimistic(0);
  const increment = () => {
    startTransition(() => {
      updateOptimisticCount((pendingCount) => pendingCount + 1);
    });
  };

  return (
    <button type="button" onClick={increment}>
      {optimisticCount}
    </button>
  );
};
