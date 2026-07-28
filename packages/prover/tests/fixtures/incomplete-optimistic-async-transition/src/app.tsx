import { useOptimistic, useTransition } from "react";

export const AsyncOptimisticTransition = () => {
  const [optimisticCount, setOptimisticCount] = useOptimistic(
    0,
    (_pendingCount, nextCount: number) => nextCount,
  );
  const [, startTransition] = useTransition();
  const updateCount = () => {
    startTransition(async () => {
      await Promise.resolve();
      setOptimisticCount(1);
    });
  };

  return (
    <button type="button" onClick={updateCount}>
      {optimisticCount}
    </button>
  );
};
