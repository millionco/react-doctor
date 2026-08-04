import { useEffect, useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  const updateCount = () => {
    setCount(count + 1);
  };

  useEffect(() => {
    updateCount();
  }, [count, updateCount]);

  return <output>{count}</output>;
};
