import { useState } from "react";

export const useCounterActions = () => {
  const [count, setCount] = useState(0);
  const increment = (step) => setCount((previous) => previous + step);
  const read = () => count;
  return { increment, read };
};
