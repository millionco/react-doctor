import { useCallback, useMemo, useState } from "react";

const doubleCount = (count: number) => count * 2;

const getNextCount = (count: number) => count + 1;

export const Counter = () => {
  const [count, setCount] = useState(0);
  const displayCount = useMemo(() => doubleCount(count), [count]);
  const increment = useCallback(() => setCount(getNextCount(count)), [count]);
  return (
    <button type="button" onClick={increment}>
      {displayCount}
    </button>
  );
};
