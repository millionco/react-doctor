// rule: rerender-functional-setstate
// weakness: control-flow
// source: independently authored synthetic
// verdict: fail
import { useState } from "react";
export const Counter = () => {
  const [count, setCount] = useState(0);
  const handleKey = (event) => {
    if (event.key === "Home") setCount(0);
    else {
      setCount(count + 1);
      setCount(count + 2);
    }
  };
  return <input onKeyDown={handleKey} value={count} />;
};
