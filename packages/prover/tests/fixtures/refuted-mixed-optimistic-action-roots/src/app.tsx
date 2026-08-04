import { useOptimistic } from "react";

export const SharedAction = () => {
  const [optimisticCount, addOptimisticCount] = useOptimistic(
    0,
    (pendingCount, increment: number) => pendingCount + increment,
  );
  const updateCount = () => addOptimisticCount(1);

  return (
    <form action={updateCount}>
      <button type="button" onClick={updateCount}>
        Also update
      </button>
      <output>{optimisticCount}</output>
    </form>
  );
};
