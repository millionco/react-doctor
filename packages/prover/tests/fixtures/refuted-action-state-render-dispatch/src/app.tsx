import { useActionState } from "react";

export const InvalidCounter = () => {
  const [count, dispatchIncrement] = useActionState(
    (previousCount: number) => previousCount + 1,
    0,
  );
  dispatchIncrement();
  return <output>{count}</output>;
};
