import { useReducer } from "react";

const increment = (count: number, _action: void): number => count + 1;

export const Counter = () => {
  const [count, dispatch] = useReducer(increment, 0);
  dispatch();
  return <p>{count}</p>;
};
