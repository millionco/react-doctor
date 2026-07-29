import { useReducer } from "react";

const reduceCount = (
  count: number | undefined,
  action: "increment" | "skip",
): number | undefined => {
  if (action === "increment") return (count ?? 0) + 1;
};

declare const initialCount: number | undefined;

export const Counter = () => {
  const [count] = useReducer(reduceCount, initialCount);
  return <p>{count ?? "missing"}</p>;
};
