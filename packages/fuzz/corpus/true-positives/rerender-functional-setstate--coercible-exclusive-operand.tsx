// rule: rerender-functional-setstate
// weakness: control-flow
// source: independently authored synthetic
// verdict: fail
import { useState } from "react";
export const Counter = ({ notify }: { notify: () => void }) => {
  const [count, setCount] = useState(0);
  const step = {
    valueOf: () => {
      notify();
      return 1;
    },
  };
  const handleKey = (event) => {
    if (event.key === "Home") setCount(0);
    else setCount(count + step);
  };
  return <input onKeyDown={handleKey} value={count} />;
};
