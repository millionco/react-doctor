import { useReducer } from "react";

const reduceCount = (count: number, action: "increment" | "reset"): number => {
  if (action === "increment") return count + 1;
  throw new Error("reset failed");
};

export const Counter = () => {
  const [count] = useReducer(reduceCount, 0);
  return <p>{count}</p>;
};
