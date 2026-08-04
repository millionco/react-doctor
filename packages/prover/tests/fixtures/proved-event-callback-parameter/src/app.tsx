import { useState } from "react";

const invokeCallback = (callback: () => void) => callback();

export const Counter = () => {
  const [count, setCount] = useState(0);
  const updateCount = () => setCount((previousCount) => previousCount + 1);
  const handleClick = () => invokeCallback(updateCount);
  return (
    <button type="button" onClick={handleClick}>
      {count}
    </button>
  );
};
