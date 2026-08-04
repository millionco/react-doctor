import { useOptimistic } from "react";

export const AuditedOptimisticState = () => {
  const [optimisticCount] = useOptimistic(0, (pendingCount, increment: number) => {
    console.log("optimistic reducer");
    return pendingCount + increment;
  });

  return <output>{optimisticCount}</output>;
};
