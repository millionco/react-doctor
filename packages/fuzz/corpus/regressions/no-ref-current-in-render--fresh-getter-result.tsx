// rule: no-ref-current-in-render
// weakness: member-provenance
// source: synthetic
// verdict: pass
import { useRef } from "react";

interface CounterProps {
  value: number;
}

export const Counter = ({ value }: CounterProps) => {
  const cache = useRef({
    get fresh() {
      return { value: 0 };
    },
  });
  cache.current.fresh.value = value;
  return <output>{value}</output>;
};
