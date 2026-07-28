import { useOptimistic } from "react";

export const AuditedOptimisticForm = () => {
  const [optimisticCount, updateOptimisticCount] = useOptimistic(0);
  const submitAction = () => {
    updateOptimisticCount((pendingCount) => {
      console.log("optimistic updater");
      return pendingCount + 1;
    });
  };

  return (
    <form action={submitAction}>
      <button type="submit">{optimisticCount}</button>
    </form>
  );
};
