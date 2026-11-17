// rule: no-ref-current-in-render
// weakness: deferred-boundary
// source: synthetic
// verdict: pass
import { useEffect, useRef } from "react";

interface CounterProps {
  value: number;
}

export const Counter = ({ value }: CounterProps) => {
  const cache = useRef({ value: 0 });
  useEffect(() => {
    cache.current.value = value;
  }, [value]);
  return <output>{value}</output>;
};
