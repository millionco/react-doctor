// rule: rerender-functional-setstate
// weakness: name-heuristic
// source: independently authored synthetic
// verdict: pass
import { useEffect, useState } from "react";
export const Counter = ({ baseline }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const count = baseline;
    setInterval(() => setCount(count + 1), 800);
  }, [baseline]);
  return <output>{count}</output>;
};
