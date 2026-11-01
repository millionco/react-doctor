// rule: no-derived-state
// verdict: pass
// weakness: copy-tracking
// source: synthetic
import { useEffect, useState } from "react";

export const ScalarTransition = ({ amount }: { amount: number }) => {
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
