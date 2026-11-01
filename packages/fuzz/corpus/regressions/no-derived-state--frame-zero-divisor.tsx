// rule: no-derived-state
// verdict: fail
// weakness: copy-tracking
// source: synthetic
import { useEffect, useState } from "react";

export const FrameZeroDivisorTransition = ({ amount }: { amount: number }) => {
  const [total, setTotal] = useState(0);
  const advance = (delta: number, divisor: number) => {
    const nextTotal = Math.ceil(total + delta / divisor);
    setTotal(nextTotal);
  };
  useEffect(() => {
    advance(amount, 0);
  });
  return <output>{total}</output>;
};
