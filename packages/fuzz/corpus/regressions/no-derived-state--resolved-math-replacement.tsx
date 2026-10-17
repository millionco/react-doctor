// rule: no-derived-state
// verdict: fail
// weakness: dynamic-computed
// source: synthetic
import { useEffect, useState } from "react";

const namespaceKey = "Math";
globalThis[namespaceKey].ceil = () => 3;

export const ResolvedScalarReplacement = ({ amount }: { amount: number }) => {
  const [total, setTotal] = useState(0);
  const advance = (delta: number) => {
    const nextTotal = Math.ceil(total + delta);
    setTotal(nextTotal);
  };
  useEffect(() => {
    advance(amount);
  });
  return <output>{total}</output>;
};
