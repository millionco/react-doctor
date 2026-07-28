import { useReducer, useState } from "react";

const setCount = (count: number) => count + 1;

export const Counter = () => {
  const [count, updateCount] = useState(0);
  const [reducedCount, dispatch] = useReducer(
    (previousCount: number, _update: (value: number) => number) => previousCount + 1,
    0,
  );

  return (
    <button
      type="button"
      onClick={() => {
        updateCount(setCount(count));
        dispatch((previousCount) => previousCount + 1);
      }}
    >
      {count + reducedCount}
    </button>
  );
};
