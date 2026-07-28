import { useState } from "react";

const startTransition = (action: () => void) => {
  action();
};

export const Counter = () => {
  const [count, setCount] = useState(0);

  return (
    <button type="button" onClick={() => startTransition(() => setCount(count + 1))}>
      {count}
    </button>
  );
};
