import { useReducer, useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  const [reducedCount, dispatch] = useReducer((previousCount: number) => {
    setCount((previousState) => previousState + 1);
    return previousCount + 1;
  }, 0);

  return (
    <button type="button" onClick={() => dispatch(undefined)}>
      {count + reducedCount}
    </button>
  );
};
