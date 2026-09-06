// rule: no-pass-live-state-to-parent
// weakness: copy-tracking
// source: Fresh handwritten local-rest regression
// verdict: fail

import { useEffect, useState } from "react";

interface CounterProps {
  label: string;
  handleChange: (count: number) => void;
}

export const Counter = (props: CounterProps) => {
  const { label, ...callbacks } = props;
  const [count, setCount] = useState(0);

  useEffect(() => {
    callbacks.handleChange(count);
  }, [callbacks, count]);

  return <button onClick={() => setCount(count + 1)}>{label}</button>;
};
