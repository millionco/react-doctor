// rule: rerender-functional-setstate
// weakness: name-heuristic
// source: independently authored synthetic
// verdict: fail
import { useEffect, useState } from "react";
export const Counter = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setInterval(() => setCount(count + 1), 800);
  }, []);
  return <output>{count}</output>;
};
