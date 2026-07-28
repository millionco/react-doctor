import { useState } from "react";

interface CounterProperties {
  updateCount: (previousCount: number) => number;
}

export const Counter = ({ updateCount }: CounterProperties) => {
  const [count, setCount] = useState(0);

  return (
    <button type="button" onClick={() => setCount(updateCount)}>
      {count}
    </button>
  );
};
