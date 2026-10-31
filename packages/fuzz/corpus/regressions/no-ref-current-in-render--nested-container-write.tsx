// rule: no-ref-current-in-render
// weakness: member-write
// source: synthetic
// verdict: fail
import { useRef } from "react";

interface CounterProps {
  value: number;
}

export const Counter = ({ value }: CounterProps) => {
  const cache = useRef({ value: 0 });
  cache.current.value = value;
  return <output>{value}</output>;
};
