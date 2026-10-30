// rule: rendering-conditional-render
// verdict: fail
// weakness: alias-guard
// source: independently synthetic numeric state write
import { useState } from "react";

export const QuantityBadge = () => {
  const [itemCount, setItemCount] = useState<string | number>("");
  return <button onClick={() => setItemCount(0)}>{itemCount && <span>{itemCount}</span>}</button>;
};
