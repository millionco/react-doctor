// rule: rerender-state-only-in-handlers
// weakness: control-flow
// source: Fresh handwritten recursive render-flow regression
// verdict: pass

import { useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  const readCount = (remaining: number): number =>
    remaining > 0 ? readCount(remaining - 1) : count;

  return <button onClick={() => setCount(count + 1)}>{readCount(2)}</button>;
};
