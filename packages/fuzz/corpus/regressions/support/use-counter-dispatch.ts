import { useReducer } from "react";

export const useCounterDispatch = () => {
  const [count, dispatch] = useReducer(
    (previous: number, increment: number) => previous + increment,
    0,
  );
  const increment = (amount: number) => dispatch(amount);
  return { count, increment };
};
