// rule: rerender-functional-setstate
// weakness: alias-guard
// source: independently authored synthetic
// verdict: fail
import { useEffect, useState } from "react";
export const Counter = () => {
  const [count, setCount] = useState(0);
  const saved = count;
  useEffect(() => {
    const count = saved;
    setInterval(() => setCount(count + 1), 800);
  }, []);
  return <output>{count}</output>;
};
