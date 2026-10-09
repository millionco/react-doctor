// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: a conditional expression hid fresh local collection ownership
// source: reduced local regression
import { useState } from "react";
export const Panel = ({ reset }) => {
  const [items, setItems] = useState(new Set());
  const add = () =>
    setItems((previous) => {
      const next = reset ? new Set() : new Set(previous);
      next.add("item");
      return next;
    });
  return <button onClick={add}>{items.size}</button>;
};
