// rule: no-derived-state
// weakness: initializer-provenance
// source: Synthetic native parity regression
import { useEffect, useState } from "react";

export const View = ({ price }) => {
  const credit = 10;
  const [total, setTotal] = useState(0);
  useEffect(() => setTotal(price - credit), [price]);
  return <div>{total}</div>;
};
