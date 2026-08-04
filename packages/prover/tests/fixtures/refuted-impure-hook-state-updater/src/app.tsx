import { useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);

  return (
    <button
      type="button"
      onClick={() =>
        setCount((previousCount) => {
          localStorage.setItem("count", String(previousCount));
          return previousCount + 1;
        })
      }
    >
      {count}
    </button>
  );
};
