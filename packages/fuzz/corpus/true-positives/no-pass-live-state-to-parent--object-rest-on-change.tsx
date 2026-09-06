// rule: no-pass-live-state-to-parent
// weakness: copy-tracking
// source: Fresh handwritten prop-rest regression
// verdict: fail

import { useEffect, useState } from "react";

interface CounterProps {
  label: string;
  onChange: (count: number) => void;
}

export const Counter = ({ label, ...callbacks }: CounterProps) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    callbacks.onChange(count);
  }, [callbacks, count]);

  return <button onClick={() => setCount(count + 1)}>{label}</button>;
};
