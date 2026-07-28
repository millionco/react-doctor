import { useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  const increment = () => setCount((previousCount) => previousCount + 1);
  const handleClick = () => {
    if (count < 0) increment();
    increment();
  };
  return (
    <button type="button" onClick={handleClick}>
      {count}
    </button>
  );
};
