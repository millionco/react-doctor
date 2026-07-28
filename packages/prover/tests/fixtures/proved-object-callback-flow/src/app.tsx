import { useState } from "react";

interface CallbackOptions {
  callback: () => void;
}

const invokeCallback = (options: CallbackOptions) => options.callback();

export const Counter = () => {
  const [count, setCount] = useState(0);
  const increment = () => setCount((previousCount) => previousCount + 1);
  const handleClick = () => invokeCallback({ callback: increment });
  return (
    <button type="button" onClick={handleClick}>
      {count}
    </button>
  );
};
