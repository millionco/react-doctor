// rule: no-pass-live-state-to-parent
// weakness: name-heuristic
// source: Fresh handwritten prop-rest read boundary
// verdict: pass

import { useEffect, useState } from "react";

interface CounterProps {
  label: string;
  search: (count: number) => void;
}

export const Counter = ({ label, ...values }: CounterProps) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    values.search(count);
  }, [values, count]);

  return <button onClick={() => setCount(count + 1)}>{label}</button>;
};
