// rule: rendering-conditional-render
// verdict: pass
// weakness: name-heuristic
// source: independently synthetic closed string/undefined state
import { useState } from "react";

const labelQuantity = (value: number) => {
  if (value < 0) return undefined;
  return `${value} items`;
};

export const QuantityBadge = ({ value }: { value: number }) => {
  const [itemCount, setItemCount] = useState<string | undefined>("");
  return (
    <button onClick={() => setItemCount(labelQuantity(value))}>
      {itemCount && <span>{itemCount}</span>}
    </button>
  );
};
