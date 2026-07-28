import { useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  setCount(count + 1);
  return <p>{count}</p>;
};
