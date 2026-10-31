// rule: no-side-effect-in-state-updater-function
// verdict: fail
// weakness: global-api
// source: synthetic
import { useState } from "react";

interface CounterProps {
  timer: number;
}

export const Counter = ({ timer }: CounterProps) => {
  const [count, setCount] = useState(0);
  return (
    <button
      onClick={() =>
        setCount((previous) => {
          globalThis.clearInterval(timer);
          return previous + 1;
        })
      }
    >
      {count}
    </button>
  );
};
