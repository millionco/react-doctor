import { useCounter } from "./use-counter.js";

export const Counter = () => {
  const count = useCounter();
  return <p>{count}</p>;
};
