// rule: no-derived-state
// verdict: fail
// weakness: copy-tracking
// source: synthetic
import { useEffect, useState } from "react";

export const DerivedScalar = ({ amount }: { amount: number }) => {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    setTotal((total, amount));
  });
  return <output>{total}</output>;
};
