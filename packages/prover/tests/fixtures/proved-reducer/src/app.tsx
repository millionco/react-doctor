import { useReducer } from "react";

const incrementCount = (count: number) => count + 1;

const reduceCount = (count: number, action: "increment" | "reset") => {
  if (action === "increment") return incrementCount(count);
  return 0;
};

export const Counter = () => {
  const [count, dispatch] = useReducer(reduceCount, 0);
  return (
    <button type="button" onClick={() => dispatch("increment")}>
      {count}
    </button>
  );
};
