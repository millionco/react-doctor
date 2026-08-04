import { useActionState } from "react";

export const Counter = () => {
  const [count, dispatchIncrement] = useActionState(
    (previousCount: number, increment: number) => previousCount + increment,
    0,
  );

  return (
    <button type="button" onClick={() => dispatchIncrement(1)}>
      Count: {count}
    </button>
  );
};
