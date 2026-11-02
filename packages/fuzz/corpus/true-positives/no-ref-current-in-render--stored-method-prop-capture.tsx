// rule: no-ref-current-in-render
// verdict: fail
// weakness: stored method captures a render-dependent value
// source: independent synthetic adversarial regression
import { useRef } from "react";

interface CounterProps {
  count: number;
}

export const Counter = ({ count }: CounterProps) => {
  const valueRef = useRef<{ read: () => number } | null>(null);
  if (valueRef.current === null) {
    valueRef.current = {
      read: () => {
        let selected = count;
        selected += 1;
        return selected;
      },
    };
  }
  return null;
};
