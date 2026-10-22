// rule: no-derived-state
// verdict: fail
// weakness: copy-tracking
// source: synthetic
import { useEffect, useState } from "react";

export const ZeroDivisorTransition = ({ amount }: { amount: number }) => {
  const [total, setTotal] = useState(0);
  const advance = (delta: number) => {
    const nextTotal = Math.ceil(total + delta / 0);
    setTotal(nextTotal);
  };
  useEffect(() => {
    advance(amount);
  });
  return <output>{total}</output>;
};
