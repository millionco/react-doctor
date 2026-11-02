// rule: exhaustive-deps
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import { useEffect, useState } from "react";
export const Counter = () => {
  const [count, setCount] = useState(0);
  interface setCount {}
  useEffect(() => {
    setCount(1);
  }, []);
  return <output>{count}</output>;
};
