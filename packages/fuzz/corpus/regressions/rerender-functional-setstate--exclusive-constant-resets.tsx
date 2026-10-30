// rule: rerender-functional-setstate
// weakness: control-flow
// source: independently authored synthetic
// verdict: pass
import { useState } from "react";
export const Counter = () => {
  const [count, setCount] = useState(0);
  const handleKey = (event) => {
    if (event.key === "Home") setCount(0);
    else if (event.key === "End") setCount(10);
    else setCount(count + 1);
  };
  return <input onKeyDown={handleKey} value={count} />;
};
