import { useState } from "react";

interface KeyboardEventLike {
  key: string;
}

const whenEnter = (callback: () => void) => (event: KeyboardEventLike) => {
  if (event.key === "Enter") callback();
};

export const Counter = () => {
  const [count, setCount] = useState(0);
  const increment = () => setCount((previousCount) => previousCount + 1);
  const handleKeyDown = whenEnter(increment);
  return (
    <button type="button" onKeyDown={handleKeyDown}>
      {count}
    </button>
  );
};
