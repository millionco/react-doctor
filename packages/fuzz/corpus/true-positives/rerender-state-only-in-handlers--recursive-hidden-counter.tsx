// rule: rerender-state-only-in-handlers
// weakness: control-flow
// source: Fresh handwritten recursive render-flow regression
// verdict: fail

import { useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  const readCount = (remaining: number): number =>
    remaining > 0 ? readCount(remaining - 1) : count;

  return <button onClick={() => setCount(count + 1)}>Advance</button>;
};
