// rule: no-adjust-state-on-prop-change
// weakness: control-flow
// source: applied-compute Fix React verifier audit, a cleanup that only reads a binding hid the target
// verdict: fail
import { useEffect, useState } from "react";

export const ItemList = ({ items }: { items: string[] }) => {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(null);
    return () => {
      items;
    };
  }, [items]);
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>
          <button type="button" onClick={() => setSelected(item)}>
            {item === selected ? "*" : ""}
            {item}
          </button>
        </li>
      ))}
    </ul>
  );
};
