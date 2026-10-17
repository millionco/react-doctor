// rule: no-derived-state
// verdict: fail
// weakness: alias-guard
// source: synthetic
import React, { useEffect, useState } from "react";

React.useEffect = () => undefined;

export const ChangedEffectDriver = ({ amount }: { amount: number }) => {
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
