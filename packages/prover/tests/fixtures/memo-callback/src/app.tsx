import { useCallback, useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount(count + 1), []);
  return <p>{increment.name}</p>;
};
