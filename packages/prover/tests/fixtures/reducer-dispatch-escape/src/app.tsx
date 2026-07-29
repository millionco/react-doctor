import { useReducer } from "react";

const increment = (count: number, _action: void): number => count + 1;

export const Counter = () => {
  const [count, dispatch] = useReducer(increment, 0);
  const controls = { dispatch };
  return <button onClick={() => controls.dispatch()}>{count}</button>;
};
